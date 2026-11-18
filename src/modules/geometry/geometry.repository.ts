import { and, desc, eq, inArray, isNull, ne, notExists, sql } from 'drizzle-orm'
import type { AnyColumn, SQL, SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Position } from 'geojson'
import { db } from '../../database/database.js'
import { asGeoJSON, asWgs84GeoJSON, fromGeoJSON, makeValid, webMercator } from '../../database/postgis.js'
import { parcellaires, parcelles } from '../../database/schema/index.js'
import type {
  GeometryConflict,
  GeometryConflictStatus,
  GeometryCorrection,
  ParcelBorder,
  ParcellaireComparable,
  ParcelleColumnKey,
  ParcellesComparees
} from './geometry.types.js'

const ancienne = alias(parcelles, 'ancienne')
const nouvelle = alias(parcelles, 'nouvelle')

function parcellesActives(table: typeof ancienne | typeof nouvelle, recordId: string): SQL | undefined {
  return and(eq(table.recordId, recordId), isNull(table.deletedAt))
}

function parcelleColumns<T extends typeof ancienne | typeof nouvelle>(table: T): Pick<T, ParcelleColumnKey> {
  return {
    id: table.id,
    numeroIlotPac: table.numeroIlotPac,
    numeroParcellesPac: table.numeroParcellesPac,
    name: table.name
  }
}

export async function findGeometryConflicts(
  inputGeomGeoJSON: unknown,
  recordId: string,
  id: string | number = ''
): Promise<GeometryConflict[]> {
  const input = fromGeoJSON(inputGeomGeoJSON)

  /** L'area n'est pas a 0 a cause des imprécision du front, et des segments frontières */
  return db
    .select({
      id: parcelles.id,
      status: sql<GeometryConflictStatus>`CASE
        WHEN ST_Contains(${input}, ${parcelles.geometry}) OR ST_Within(${input}, ${parcelles.geometry}) THEN 'inclusion'
        WHEN ST_Intersects(${input}, ${parcelles.geometry}) AND ST_Area(ST_Intersection(${input}, ${parcelles.geometry})) > 0.000000000001 THEN 'overlap'
        ELSE 'ok'
      END`
    })
    .from(parcelles)
    .where(and(eq(parcelles.recordId, recordId), ne(parcelles.id, String(id)), isNull(parcelles.deletedAt)))
}

export async function findGeometryCorrections(
  inputGeomGeoJSON: unknown,
  recordId: string,
  ids: string[]
): Promise<GeometryCorrection[]> {
  const input = fromGeoJSON(inputGeomGeoJSON)

  return db
    .select({
      id: parcelles.id,
      new_minus_intersection: asGeoJSON(sql`ST_Difference(${input}, ${parcelles.geometry})`),
      existing_minus_intersection: asGeoJSON(sql`ST_Difference(${parcelles.geometry}, ${input})`),
      intersection: asGeoJSON(sql`ST_Intersection(${parcelles.geometry}, ${input})`)
    })
    .from(parcelles)
    .where(and(eq(parcelles.recordId, recordId), inArray(parcelles.id, ids)))
}

export async function findParcellairesComparables(recordIds: string[]): Promise<ParcellaireComparable[]> {
  return db
    .select({
      recordId: parcellaires.recordId,
      numeroBio: parcellaires.numeroBio,
      auditDate: parcellaires.auditDate,
      anneeReferenceControle: parcellaires.anneeReferenceControle,
      createdAt: parcellaires.createdAt
    })
    .from(parcellaires)
    .where(inArray(parcellaires.recordId, recordIds))
}

export async function findParcellesComparees(oldRecordId: string, newRecordId: string): Promise<ParcellesComparees> {
  const recouvrement = (
    geometry: AnyColumn,
    autre: AnyColumn
  ): SQL => sql`ST_Intersects(${makeValid(autre)}, ${makeValid(geometry)})
    AND ST_Area(ST_Intersection(${makeValid(autre)}, ${makeValid(geometry)})) / ST_Area(${makeValid(geometry)}) > 0.1`

  const intersectionArea = sql`ST_Area(ST_Intersection(${makeValid(ancienne.geometry)}, ${makeValid(nouvelle.geometry)}))`

  const [modified, deleted, added] = await Promise.all([
    db
      .selectDistinctOn([nouvelle.id], {
        geometry: asGeoJSON(nouvelle.geometry),
        ancienne: parcelleColumns(ancienne),
        nouvelle: parcelleColumns(nouvelle)
      })
      .from(ancienne)
      .innerJoin(
        nouvelle,
        and(
          sql`ST_Intersects(${makeValid(ancienne.geometry)}, ${makeValid(nouvelle.geometry)})`,
          sql`${intersectionArea} > 0.00000001`
        )
      )
      .where(
        and(
          parcellesActives(ancienne, oldRecordId),
          parcellesActives(nouvelle, newRecordId),
          sql`NOT ST_Equals(
          ST_ReducePrecision(${makeValid(nouvelle.geometry)}, 0.0001),
          ST_ReducePrecision(${makeValid(ancienne.geometry)}, 0.0001)
        )`
        )
      )
      .orderBy(nouvelle.id, desc(intersectionArea)),

    db
      .select({ geometry: asGeoJSON(ancienne.geometry), ...parcelleColumns(ancienne) })
      .from(ancienne)
      .where(
        and(
          parcellesActives(ancienne, oldRecordId),
          notExists(
            db
              .select({ id: nouvelle.id })
              .from(nouvelle)
              .where(and(parcellesActives(nouvelle, newRecordId), recouvrement(ancienne.geometry, nouvelle.geometry)))
          )
        )
      ),

    db
      .select({ geometry: asGeoJSON(nouvelle.geometry), ...parcelleColumns(nouvelle) })
      .from(nouvelle)
      .where(
        and(
          parcellesActives(nouvelle, newRecordId),
          notExists(
            db
              .select({ id: ancienne.id })
              .from(ancienne)
              .where(and(parcellesActives(ancienne, oldRecordId), recouvrement(nouvelle.geometry, ancienne.geometry)))
          )
        )
      )
  ])

  return { modified, deleted, added }
}

export async function findParcelBorder(geometry: unknown, distance: number): Promise<ParcelBorder | undefined> {
  const parcelle = db
    .$with('parcelle', { geom: sql`geom`.as('geom') })
    .as(sql`SELECT ${webMercator(fromGeoJSON(geometry))} AS geom`)

  const bordure = db.$with('bordure', { geom: sql`geom`.as('geom') }).as(sql`
      SELECT ST_Difference(agrandie, ST_Buffer(agrandie, ${-(distance + 0.01)})) AS geom
      FROM (SELECT ST_Buffer(${parcelle.geom}, 0.01) AS agrandie FROM ${parcelle}) AS parcelle_agrandie
    `)

  const [result] = await db
    .with(parcelle, bordure)
    .select({
      parcelleSansBordure: asWgs84GeoJSON(sql`ST_Difference(${parcelle.geom}, ${bordure.geom})`),
      bordure: asWgs84GeoJSON(bordure.geom)
    })
    .from(parcelle)
    .crossJoin(bordure)

  return result
}

export async function findParcelBorderBetweenPoints(
  geometry: unknown,
  distance: number,
  start: Position,
  end: Position,
  isInverted: boolean
): Promise<ParcelBorder | undefined> {
  const parcelle = db
    .$with('parcelle', { geom: sql`geom`.as('geom') })
    .as(sql`SELECT ${webMercator(fromGeoJSON(geometry))} AS geom`)

  const contour = db
    .$with('contour', { ligne: sql`ligne`.as('ligne') })
    .as(sql`SELECT ST_ExteriorRing(${parcelle.geom}) AS ligne FROM ${parcelle}`)

  const positions = db.$with('positions', {
    ligne: sql`ligne`.as('ligne'),
    debut: sql`debut`.as('debut'),
    fin: sql`fin`.as('fin')
  }).as(sql`
      SELECT ligne, LEAST(a, b) AS debut, GREATEST(a, b) AS fin
      FROM (
        SELECT
          ${contour.ligne} AS ligne,
          ST_LineLocatePoint(${contour.ligne}, ${webMercator(sql`ST_MakePoint(${start[0]}, ${start[1]})`)}) AS a,
          ST_LineLocatePoint(${contour.ligne}, ${webMercator(sql`ST_MakePoint(${end[0]}, ${end[1]})`)}) AS b
        FROM ${contour}
      ) AS points
    `)

  const sousLigne = (from: SQLWrapper, to: SQLWrapper): SQL => sql`ST_LineSubstring(${positions.ligne}, ${from}, ${to})`
  const versFin = sousLigne(positions.fin, sql`1.0`)
  const depuisDebut = sousLigne(sql`0.0`, positions.debut)

  const arc = isInverted
    ? sql`CASE
        WHEN ${positions.debut} < 0.001 THEN ${versFin}
        WHEN ${positions.fin} > 0.999 THEN ${depuisDebut}
        ELSE ST_LineMerge(ST_Union(${versFin}, ${depuisDebut}))
      END`
    : sousLigne(positions.debut, positions.fin)

  const bande = db.$with('bande', { geom: sql`geom`.as('geom') }).as(sql`
      SELECT ST_Buffer(${arc}, ${Math.abs(distance)}, 'endcap=square join=round quad_segs=8') AS geom
      FROM ${positions}
      WHERE ST_Length(${positions.ligne}) > 0
    `)

  const [result] = await db
    .with(parcelle, contour, positions, bande)
    .select({
      parcelleSansBordure: asWgs84GeoJSON(
        sql`COALESCE(ST_Difference(${parcelle.geom}, ${bande.geom}), ${parcelle.geom})`
      ),
      bordure: asWgs84GeoJSON(sql`CASE
        WHEN ST_Intersects(${bande.geom}, ${parcelle.geom}) THEN ST_MakeValid(ST_Intersection(${bande.geom}, ${parcelle.geom}))
      END`)
    })
    .from(parcelle)
    .leftJoin(bande, sql`true`)

  return result
}
