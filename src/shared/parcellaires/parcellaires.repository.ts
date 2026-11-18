import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, exists, inArray, isNull, notExists, notInArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Polygon } from 'geojson'

import { db, firstRow } from '../../database/database.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import {
  communes,
  organismeCertificateur,
  parcelleCultures,
  parcellaires,
  parcellairesEvenements,
  parcellairesMetadata,
  parcelles,
  parcellesAnnotations,
  parcellesControles,
  territoires
} from '../../database/schema/index.js'
import type { CertificationState } from '@agencebio/cartobio-types'
import type { HistoryEntry, CartoBioFeatureInput, CartoBioHistoriqueCulture } from '@agencebio/cartobio-types'
import type {
  DBOperatorRecord,
  DBOperatorRecordWithParcelles,
  DBParcelle,
  GeometryAnalysis,
  PreviousParcelle,
  RecordInput,
  RecordSummaryRow
} from './parcellaires.types.js'
import { MissingGeometryApiError } from '../errors.js'
import { getRandomFeatureId } from '../outputs/features.js'
import {
  annotationCodes,
  createParcelleAnnotationSchema,
  createParcelleCultureSchema,
  isAnnotationCode
} from '../../database/validations/parcelles.js'
import {
  certificationEtatEnumSchema,
  createParcellaireEvenementSchema,
  createParcellaireMetadataSchema,
  createParcellaireSchema,
  updateParcellaireSchema
} from '../../database/validations/parcellaires.js'
import { createOrganismeCertificateurSchema } from '../../database/validations/references.js'
import {
  blankToNull,
  chunk,
  communeLaPlusProche,
  coalesceBlank,
  culturesJson,
  eventTypes,
  INSERT_BATCH_SIZE,
  notInKeys,
  parcelleColumns,
  parcelleInsertValues,
  parcelleUpdateSet,
  recordColumns
} from './parcellaires.utils.js'
import { areaHa, wgs84FromGeoJSON } from '../../database/postgis.js'

type FeatureProperties = CartoBioFeatureInput['properties']

const statutImportGeom = (statut: string | null | undefined): SQL =>
  sql`${statut === 'ACCEPTENONCORRIGE' ? 'ACCEPTE_NON_CORRIGE' : (statut ?? null)}::cartobio.statut_import_geom`

const surfaceCulture = (surface: unknown): string | null => {
  const value = String(surface ?? '').replace(',', '.')
  return /^\d+(\.\d+)?$/.test(value) ? value : null
}

const dateSemis = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null

async function insertEvent(tx: NodePgDatabase, recordId: string, entry: HistoryEntry | null): Promise<void> {
  if (!entry) return

  await tx.insert(parcellairesEvenements).values(
    createParcellaireEvenementSchema.parse({
      recordId,
      type: eventTypes[entry.type],
      certificationEtat: (entry.state as CertificationState | undefined) ?? null,
      date: new Date(entry.date),
      userId: entry.user?.id != null ? String(entry.user.id) : null,
      userRole: entry.user?.mainGroup?.nom ?? null,
      parcellesId: entry.featureIds
        ? (entry.featureIds.map((id) => (id == null ? null : String(id))) as string[])
        : null,
      description: entry.description ?? null,
      metadata: entry.metadata ?? null
    })
  )
}

async function ensureOrganismeCertificateur(
  tx: NodePgDatabase,
  ocId: number | null | undefined,
  ocLabel: string | null | undefined
): Promise<void> {
  if (ocId == null) return

  await tx
    .insert(organismeCertificateur)
    .values(createOrganismeCertificateurSchema.parse({ id: ocId, label: ocLabel || String(ocId) }))
    .onConflictDoNothing()
}

async function upsertMetadata(
  tx: NodePgDatabase,
  recordId: string,
  metadata: Record<string, unknown> | null | undefined
): Promise<void> {
  const meta = metadata ?? {}
  const sourceLastUpdate =
    typeof meta.sourceLastUpdate === 'string' && !Number.isNaN(Date.parse(meta.sourceLastUpdate))
      ? new Date(meta.sourceLastUpdate)
      : null
  const year = (value: unknown): number | null => (/^\d{4}$/.test(String(value ?? '')) ? Number(value) : null)
  const values = createParcellaireMetadataSchema.omit({ recordId: true }).parse({
    source: typeof meta.source === 'string' ? meta.source : null,
    sourceUpdatedAt: sourceLastUpdate,
    provenance: typeof meta.provenance === 'string' ? meta.provenance : null,
    campagne: year(meta.campagne),
    numeroPacage: meta.pacage == null ? null : String(meta.pacage),
    anneeAssolement: year(meta.anneeAssolement),
    copyOf: meta.copy_of == null ? null : String(meta.copy_of),
    warnings: meta.warnings ?? null
  })

  await tx
    .insert(parcellairesMetadata)
    .values({ recordId, ...values })
    .onConflictDoUpdate({ target: parcellairesMetadata.recordId, set: values })
}

async function upsertCultures(
  tx: NodePgDatabase,
  recordId: string,
  parcelleId: string,
  cultures: FeatureProperties['cultures'] | null | undefined
): Promise<void> {
  await upsertParcellesCultures(tx, recordId, new Map([[parcelleId, cultures]]))
}

async function upsertParcellesCultures(
  tx: NodePgDatabase,
  recordId: string,
  culturesByParcelle: Map<string, FeatureProperties['cultures'] | null | undefined>
): Promise<void> {
  const entries = Array.from(culturesByParcelle).flatMap(([parcelleId, cultures]) =>
    cultures ? [{ parcelleId, cultures }] : []
  )
  if (entries.length === 0) return

  const values = entries.flatMap(({ parcelleId, cultures }) =>
    cultures.map((culture, position) =>
      createParcelleCultureSchema.parse({
        id: String(culture.id ?? randomUUID()),
        recordId,
        parcelleId,
        cpf: blankToNull(culture.CPF),
        codeCultureImport: blankToNull(culture.TYPE),
        surface: surfaceCulture(culture.surface),
        unit: blankToNull(culture.unit),
        variete: blankToNull(culture.variete),
        dateSemis: dateSemis(culture.date_semis),
        commentaire: blankToNull(culture.commentaire),
        position
      })
    )
  )

  await tx.delete(parcelleCultures).where(
    and(
      eq(parcelleCultures.recordId, recordId),
      inArray(
        parcelleCultures.parcelleId,
        entries.map(({ parcelleId }) => parcelleId)
      ),
      values.length > 0 ? notInKeys(parcelleCultures.parcelleId, parcelleCultures.id, values) : undefined
    )
  )

  for (const batch of chunk(values, INSERT_BATCH_SIZE)) {
    await tx
      .insert(parcelleCultures)
      .values(batch)
      .onConflictDoUpdate({
        target: [parcelleCultures.recordId, parcelleCultures.parcelleId, parcelleCultures.id],
        set: {
          cpf: sql`excluded.cpf`,
          codeCultureImport: sql`excluded.code_culture_import`,
          surface: sql`excluded.surface`,
          unit: sql`excluded.unit`,
          variete: sql`excluded.variete`,
          dateSemis: sql`excluded.date_semis`,
          commentaire: sql`excluded.commentaire`,
          position: sql`excluded.position`
        }
      })
  }
}

async function upsertAnnotations(
  tx: NodePgDatabase,
  recordId: string,
  parcelleId: string,
  annotations: FeatureProperties['annotations'] | null | undefined
): Promise<void> {
  await upsertParcellesAnnotations(tx, recordId, new Map([[parcelleId, annotations]]))
}

async function upsertParcellesAnnotations(
  tx: NodePgDatabase,
  recordId: string,
  annotationsByParcelle: Map<string, FeatureProperties['annotations'] | null | undefined>
): Promise<void> {
  const entries = Array.from(annotationsByParcelle).flatMap(([parcelleId, annotations]) =>
    annotations ? [{ parcelleId, annotations }] : []
  )
  if (entries.length === 0) return

  const values = entries.flatMap(({ parcelleId, annotations }) =>
    annotations.flatMap((annotation) => {
      const code = String(annotation.code)
      if (!isAnnotationCode(code)) return []

      return [
        createParcelleAnnotationSchema.parse({
          id: z.uuid().safeParse(annotation.id).success ? String(annotation.id) : randomUUID(),
          recordId,
          parcelleId,
          typeAnnot: annotationCodes[code],
          createdAt:
            typeof annotation.date === 'string' && !Number.isNaN(Date.parse(annotation.date))
              ? new Date(annotation.date)
              : new Date(),
          metadata: annotation.metadata ?? null
        })
      ]
    })
  )

  await tx.delete(parcellesAnnotations).where(
    and(
      eq(parcellesAnnotations.recordId, recordId),
      inArray(
        parcellesAnnotations.parcelleId,
        entries.map(({ parcelleId }) => parcelleId)
      ),
      values.length > 0 ? notInKeys(parcellesAnnotations.parcelleId, parcellesAnnotations.id, values) : undefined
    )
  )

  for (const batch of chunk(values, INSERT_BATCH_SIZE)) {
    await tx
      .insert(parcellesAnnotations)
      .values(batch)
      .onConflictDoUpdate({
        target: [parcellesAnnotations.recordId, parcellesAnnotations.parcelleId, parcellesAnnotations.id],
        set: {
          typeAnnot: sql`excluded.type_annot`,
          createdAt: sql`excluded.created_at`,
          metadata: sql`excluded.metadata`
        }
      })
  }
}

async function findParcelles(tx: NodePgDatabase, recordId: string, ids: string[]): Promise<DBParcelle[]> {
  if (ids.length === 0) return []

  const rows = await tx
    .select(parcelleColumns)
    .from(parcelles)
    .where(and(eq(parcelles.recordId, recordId), inArray(parcelles.id, ids)))

  return ids.flatMap((id) => rows.filter((row) => row.id === id))
}

async function hasRecordForOc(numeroBio: string | number, ocId: number): Promise<boolean> {
  const [row] = await db
    .select({ recordId: parcellaires.recordId })
    .from(parcellaires)
    .where(
      and(eq(parcellaires.numeroBio, Number(numeroBio)), eq(parcellaires.ocId, ocId), isNull(parcellaires.deletedAt))
    )
    .limit(1)
  return row !== undefined
}

async function findCertificationStateAtAuditDate(
  tx: NodePgDatabase,
  numerobio: string | undefined,
  auditDate: string | null | undefined
): Promise<string | null> {
  if (!auditDate) return null

  const [row] = await tx
    .select({ certification_state: parcellaires.certificationEtat })
    .from(parcellaires)
    .where(
      and(
        eq(parcellaires.numeroBio, Number(numerobio)),
        sql`${parcellaires.auditDate} = ${auditDate}::date`,
        isNull(parcellaires.deletedAt)
      )
    )

  return row?.certification_state ?? null
}

async function findMatchingPreviousParcelles(
  tx: NodePgDatabase,
  numerobio: string,
  previousRecordId: string,
  geometries: Array<CartoBioFeatureInput['geometry']>
): Promise<Array<PreviousParcelle | null>> {
  if (!geometries.length) return []

  const previousGeometry = sql`ST_MakeValid(${parcelles.geometry})`
  const intersection = sql`ST_area(ST_Intersection(${previousGeometry}, parcelle_geom))`

  const result = await tx.execute<{ [K in keyof PreviousParcelle]: PreviousParcelle[K] | null }>(sql`
    WITH input AS MATERIALIZED (
      SELECT i.ord, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(i.value), 4326)) AS parcelle_geom
      FROM jsonb_array_elements(${JSON.stringify(geometries)}::jsonb) WITH ORDINALITY AS i(value, ord)
    )
    SELECT previous.*
    FROM input
    LEFT JOIN LATERAL (
      SELECT
        ${parcelles.id} AS id,
        ${culturesJson(parcelles.recordId, parcelles.id)} AS cultures,
        ${parcelles.conversionNiveau} AS conversion_niveau,
        ${parcelles.engagementDate} AS engagement_date,
        ${parcelles.name} AS name
      FROM ${parcelles}
      INNER JOIN ${parcellaires} ON ${parcellaires.recordId} = ${parcelles.recordId}
      WHERE ${parcellaires.numeroBio} = ${Number(numerobio)}
        AND ${parcellaires.recordId} = ${previousRecordId}
        AND ${parcellaires.deletedAt} IS NULL
        AND ${parcelles.deletedAt} IS NULL
        AND ${intersection} / (ST_area(${previousGeometry}) / 100) > 99
        AND ${intersection} / (ST_area(parcelle_geom) / 100) > 99
      ORDER BY ${parcelles.createdAt} DESC
      LIMIT 1
    ) previous ON true
    ORDER BY input.ord
  `)

  return result.rows.map((row) => (row.id === null ? null : (row as PreviousParcelle)))
}

async function copyParcellesFromPreviousRecord(
  tx: NodePgDatabase,
  recordId: string,
  numerobio: string,
  previousRecordId: string
): Promise<Array<DBParcelle>> {
  const cpBase = alias(parcelles, 'cp_base')
  const intersection = sql`ST_Area(ST_Intersection(${cpBase.geometry}, ${parcelles.geometry}))`

  const copied = await tx
    .insert(parcelles)
    .select(
      tx
        .select({
          recordId: sql`${recordId}::uuid`.as('record_id'),
          id: parcelles.id,
          geometry: parcelles.geometry,
          surfaceHa: parcelles.surfaceHa,
          commune: parcelles.commune,
          conversionNiveau: parcelles.conversionNiveau,
          engagementDate: parcelles.engagementDate,
          auditeurNotesParcelles: sql`NULL`.as('auditeur_notes_parcelles'),
          name: parcelles.name,
          referenceCadastre: parcelles.referenceCadastre,
          codeCulturePac: parcelles.codeCulturePac,
          codePrecisionPac: parcelles.codePrecisionPac
        })
        .from(parcelles)
        .innerJoin(parcellaires, eq(parcellaires.recordId, parcelles.recordId))
        .where(
          and(
            eq(parcellaires.recordId, previousRecordId),
            eq(parcellaires.numeroBio, Number(numerobio)),
            isNull(parcellaires.deletedAt),
            isNull(parcelles.deletedAt),
            exists(
              tx
                .select({ one: sql`1` })
                .from(parcellairesEvenements)
                .where(
                  and(
                    eq(parcellairesEvenements.recordId, parcellaires.recordId),
                    eq(parcellairesEvenements.type, 'FEATURE_COLLECTION_CREATE'),
                    eq(parcellairesEvenements.certificationEtat, certificationEtatEnumSchema.enum.OPERATOR_DRAFT),
                    sql`NOT (${parcelles.id} = ANY(${parcellairesEvenements.parcellesId}))`
                  )
                )
            ),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(cpBase)
                .where(
                  and(
                    eq(cpBase.recordId, recordId),
                    sql`ST_Intersects(${cpBase.geometry}, ${parcelles.geometry})`,
                    sql`(${intersection} / ST_Area(${cpBase.geometry}) > 0.5 OR ${intersection} / ST_Area(${parcelles.geometry}) > 0.5)`,
                    isNull(cpBase.deletedAt)
                  )
                )
            )
          )
        )
    )
    .onConflictDoNothing({ target: [parcelles.recordId, parcelles.id] })
    .returning({ id: parcelles.id })

  const ids = copied.map(({ id }) => id)

  if (ids.length > 0) {
    await tx.insert(parcelleCultures).select(
      tx
        .select({
          id: parcelleCultures.id,
          recordId: sql`${recordId}::uuid`.as('record_id'),
          parcelleId: parcelleCultures.parcelleId,
          cpf: parcelleCultures.cpf,
          codeCultureImport: parcelleCultures.codeCultureImport,
          surface: parcelleCultures.surface,
          unit: parcelleCultures.unit,
          variete: parcelleCultures.variete,
          dateSemis: parcelleCultures.dateSemis,
          commentaire: parcelleCultures.commentaire,
          position: parcelleCultures.position
        })
        .from(parcelleCultures)
        .where(and(eq(parcelleCultures.recordId, previousRecordId), inArray(parcelleCultures.parcelleId, ids)))
    )
  }

  return findParcelles(tx, recordId, ids)
}

async function findLastAuditedRecordId(numeroBio: string): Promise<string | null> {
  const [row] = await db
    .select({ recordId: parcellaires.recordId })
    .from(parcellaires)
    .where(
      and(
        inArray(parcellaires.certificationEtat, [
          certificationEtatEnumSchema.enum.CERTIFIED,
          certificationEtatEnumSchema.enum.AUDITED,
          certificationEtatEnumSchema.enum.PENDING_CERTIFICATION
        ]),
        eq(parcellaires.numeroBio, Number(numeroBio)),
        isNull(parcellaires.deletedAt)
      )
    )
    .orderBy(
      desc(sql`${parcellaires.certificationEtat} = ${certificationEtatEnumSchema.enum.CERTIFIED}`),
      desc(parcellaires.auditDate)
    )
    .limit(1)

  return row?.recordId ?? null
}

async function markCertificationNotified(tx: NodePgDatabase, recordId: string): Promise<void> {
  await tx
    .update(parcellaires)
    .set({ dateDerniereNotif: sql`now()` })
    .where(eq(parcellaires.recordId, recordId))
}

async function findRecord(tx: NodePgDatabase, recordId: string): Promise<DBOperatorRecord | null> {
  const [record] = await tx
    .select(recordColumns)
    .from(parcellaires)
    .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
    .where(and(eq(parcellaires.recordId, recordId), isNull(parcellaires.deletedAt)))
    .limit(1)

  return record ?? null
}

async function upsertOperator(
  tx: NodePgDatabase,
  record: RecordInput,
  certificationState: CertificationState,
  historyEntry: HistoryEntry
): Promise<DBOperatorRecord> {
  await ensureOrganismeCertificateur(tx, record.oc_id, record.oc_label)

  const auditDate = sql`nullif(${record.audit_date ?? null}::text, '')::date`
  const anneeReferenceControle = sql`nullif(${record.annee_reference_controle == null ? null : String(record.annee_reference_controle)}::text, '')::int`

  const { recordId } = firstRow(
    await tx
      .insert(parcellaires)
      .values({
        ...createParcellaireSchema
          .pick({ numeroBio: true, ocId: true, certificationEtat: true, auditNotesCertif: true })
          .parse({
            numeroBio: Number(record.numerobio),
            ocId: record.oc_id ?? null,
            certificationEtat: certificationState,
            auditNotesCertif: blankToNull(record.audit_notes)
          }),
        createdAt: sql`now()`,
        certificationDateDebut: sql`nullif(${record.certification_date_debut ?? null}::text, '')::date`,
        certificationDateFin: sql`nullif(${record.certification_date_fin ?? null}::text, '')::date`,
        auditDate,
        versionNom: sql`COALESCE(${blankToNull(record.version_name)}::text, 'Version créée le ' || to_char(now(), 'DD/MM/YYYY'))`,
        anneeReferenceControle: sql`COALESCE(${anneeReferenceControle}, DATE_PART('year', COALESCE(${auditDate}, now())))`
      })
      .onConflictDoUpdate({
        target: [parcellaires.numeroBio, parcellaires.auditDate],
        targetWhere: sql`${parcellaires.deletedAt} IS NULL`,
        set: {
          ocId: record.oc_id ?? null,
          updatedAt: sql`now()`,
          certificationEtat: sql`coalesce(${certificationState}::cartobio.certification_type, ${parcellaires.certificationEtat})`,
          certificationDateDebut: sql`nullif(coalesce(${record.certification_date_debut ?? null}::text, ${parcellaires.certificationDateDebut}::text), '')::date`,
          certificationDateFin: sql`nullif(coalesce(${record.certification_date_fin ?? null}::text, ${parcellaires.certificationDateFin}::text), '')::date`,
          auditNotesCertif: coalesceBlank(record.audit_notes, parcellaires.auditNotesCertif),
          versionNom: sql`coalesce(${blankToNull(record.version_name)}::text, ${parcellaires.versionNom})`,
          anneeReferenceControle: sql`coalesce(${anneeReferenceControle}, ${parcellaires.anneeReferenceControle})`
        }
      })
      .returning({ recordId: parcellaires.recordId })
  )

  await upsertMetadata(tx, recordId, record.metadata)
  await insertEvent(tx, recordId, historyEntry)

  const saved = await findRecord(tx, recordId)
  if (!saved) throw new Error(`Parcellaire ${recordId} introuvable après son enregistrement`)
  return saved
}

async function upsertParcelles(
  tx: NodePgDatabase,
  recordId: string,
  features: Array<CartoBioFeatureInput>
): Promise<Array<DBParcelle>> {
  const ids: string[] = []
  const culturesByParcelle = new Map<string, FeatureProperties['cultures']>()
  const annotationsByParcelle = new Map<string, FeatureProperties['annotations']>()
  for (const feature of features) {
    const properties = feature.properties
    const id = String(feature.id || getRandomFeatureId())
    ids.push(id)
    if (properties.cultures) culturesByParcelle.set(id, properties.cultures)
    if (properties.annotations) annotationsByParcelle.set(id, properties.annotations)
    const etranger = sql`coalesce(${properties.etranger ?? false}::boolean, ${parcelles.etranger})`
    const importSet = {
      statutImportGeom: sql`coalesce(${statutImportGeom(properties.statut_import_geom || 'ACCEPTE')}, ${parcelles.statutImportGeom})`,
      attentePac: sql`coalesce(${properties.attente_pac ?? null}::boolean, ${parcelles.attentePac})`
    }

    if (!feature.geometry) {
      const updated = await tx
        .update(parcelles)
        .set({ ...parcelleUpdateSet(properties, parcelles.geometry, etranger), ...importSet })
        .where(and(eq(parcelles.recordId, recordId), eq(parcelles.id, id)))
        .returning({ id: parcelles.id })

      if (!updated.length) {
        throw new MissingGeometryApiError('Impossible de créer une parcelle sans donnée géographique.')
      }

      continue
    }

    const geometry = wgs84FromGeoJSON(feature.geometry)

    await tx
      .insert(parcelles)
      .values({
        ...parcelleInsertValues(recordId, id, properties, geometry, sql`${properties.etranger ?? false}::boolean`),
        statutImportGeom: statutImportGeom(properties.statut_import_geom || 'ACCEPTE'),
        attentePac: sql`coalesce(${properties.attente_pac ?? null}::boolean, false)`
      })
      .onConflictDoUpdate({
        target: [parcelles.recordId, parcelles.id],
        set: {
          ...parcelleUpdateSet(properties, geometry, etranger),
          ...importSet,
          geometry,
          surfaceHa: areaHa(geometry)
        }
      })
  }

  await upsertParcellesCultures(tx, recordId, culturesByParcelle)
  await upsertParcellesAnnotations(tx, recordId, annotationsByParcelle)

  return findParcelles(tx, recordId, ids)
}

async function deleteMissingParcelles(
  tx: NodePgDatabase,
  recordId: string,
  existing: Array<DBParcelle>
): Promise<void> {
  const ids = existing.map((parcelle) => parcelle.id)

  await tx
    .delete(parcelles)
    .where(and(eq(parcelles.recordId, recordId), ids.length > 0 ? notInArray(parcelles.id, ids) : undefined))
}

async function findMixite(tx: NodePgDatabase, recordId: string): Promise<string | null> {
  const [row] = await tx
    .select({
      mixite: sql<string | null>`CASE
        WHEN COUNT(*) FILTER (WHERE ${parcelles.conversionNiveau} = 'AB') = COUNT(*) THEN 'AB'
        WHEN COUNT(*) FILTER (WHERE ${parcelles.conversionNiveau} IN ('C1', 'C2', 'C3', 'AB')) = COUNT(*) THEN 'ABCONV'
        WHEN COUNT(*) FILTER (WHERE ${parcelles.conversionNiveau} = 'CONV') > 0 THEN 'MIXTE'
      END`
    })
    .from(parcelles)
    .where(
      and(
        eq(parcelles.recordId, recordId),
        isNull(parcelles.deletedAt),
        sql`NOT EXISTS (
        SELECT 1 FROM ${parcelleCultures}
        WHERE ${parcelleCultures.recordId} = ${parcelles.recordId}
          AND ${parcelleCultures.parcelleId} = ${parcelles.id}
          AND ${parcelleCultures.cpf} IN ('01.99.10.1', '01.99.10.2')
      )`
      )
    )

  return row?.mixite ?? null
}

async function updateMixite(tx: NodePgDatabase, recordId: string): Promise<void> {
  await tx
    .update(parcellaires)
    .set(updateParcellaireSchema.parse({ mixite: await findMixite(tx, recordId) }))
    .where(eq(parcellaires.recordId, recordId))
}

async function findRecords(numeroBio: string | number): Promise<RecordSummaryRow[]> {
  const rows = await db
    .select({
      ...recordColumns,
      geojson: sql<Record<string, unknown>>`jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(${parcelles.geometry})::jsonb,
            'properties', json_build_object(
              'conversion_niveau', ${parcelles.conversionNiveau},
              'attente_pac', ${parcelles.attentePac},
              'numero_ilot', ${parcelles.numeroIlotPac}::text
            )
          )
        ) FILTER (WHERE ${parcelles.id} IS NOT NULL), '[]'::jsonb)
      )`,
      parcelles: sql<string>`COUNT(${parcelles.id})`,
      surface: sql<number | null>`SUM(ST_Area(cartobio.to_legal_projection(${parcelles.geometry})))`
    })
    .from(parcellaires)
    .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
    .leftJoin(parcelles, and(eq(parcellaires.recordId, parcelles.recordId), isNull(parcelles.deletedAt)))
    .where(and(eq(parcellaires.numeroBio, Number(numeroBio)), isNull(parcellaires.deletedAt)))
    .groupBy(parcellaires.recordId, parcellairesMetadata.recordId)
    .orderBy(
      sql`COALESCE(${parcellaires.certificationDateDebut}, ${parcellaires.auditDate}, ${parcellaires.createdAt}) DESC`,
      sql`COALESCE(${parcellaires.auditDate}, ${parcellaires.createdAt}) DESC`
    )

  return rows
}

async function findRecordParcelles(
  record: DBOperatorRecord,
  userId: number | null = null
): Promise<DBOperatorRecordWithParcelles> {
  if (record && !record.parcelles) {
    const dp = alias(parcelles, 'dp')
    const dpRecord = alias(parcellaires, 'dp_record')
    const r = alias(parcelles, 'r')
    const co = alias(parcellaires, 'co')

    const historiqueCultures = db.$with('historique_cultures').as(
      db
        .select({
          parcelle_id: sql<string>`${dp.id}`.as('parcelle_id'),
          cultures: sql`${culturesJson(r.recordId, r.id)}`.as('cultures'),
          conversion_niveau: sql`${r.conversionNiveau}`.as('conversion_niveau'),
          annee_reference_controle: sql<number>`${co.anneeReferenceControle}`.as('annee_reference_controle'),
          audit_date: sql`${co.auditDate}`.as('audit_date'),
          intersection_ratio:
            sql<number>`ST_Area(ST_Intersection(${dp.geometry}, ${r.geometry})) / ST_Area(${dp.geometry})`.as(
              'intersection_ratio'
            )
        })
        .from(r)
        .innerJoin(dp, sql`ST_Intersects(${dp.geometry}, ${r.geometry})`)
        .innerJoin(dpRecord, eq(dpRecord.recordId, dp.recordId))
        .innerJoin(co, eq(r.recordId, co.recordId))
        .where(
          and(
            eq(dp.recordId, record.record_id),
            sql`${co.certificationEtat} = 'CERTIFIED'`,
            sql`ST_Isvalid(${r.geometry}) AND ST_Isvalid(${dp.geometry})`,
            sql`${co.anneeReferenceControle} <= ${dpRecord.anneeReferenceControle}`,
            sql`(${co.auditDate} < ${dpRecord.auditDate} OR ${dpRecord.auditDate} IS NULL)`,
            eq(co.numeroBio, dpRecord.numeroBio),
            sql`${co.anneeReferenceControle} >= EXTRACT(YEAR FROM CURRENT_DATE) - 3`,
            isNull(r.deletedAt),
            isNull(co.deletedAt)
          )
        )
    )

    const rows = await db
      .with(historiqueCultures)
      .select({
        ...parcelleColumns,
        controlee: sql<boolean>`${parcellesControles.parcelleId} IS NOT NULL`,
        historique_cultures: sql<CartoBioHistoriqueCulture[]>`(
          jsonb_build_array(
            jsonb_build_object(
              'cultures', ${culturesJson(parcelles.recordId, parcelles.id)},
              'conversion_niveau', ${parcelles.conversionNiveau},
              'annee_controle', ${parcellaires.anneeReferenceControle}
            )
          )
          ||
          coalesce(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'cultures', ${historiqueCultures.cultures},
                  'conversion_niveau', ${historiqueCultures.conversion_niveau},
                  'annee_controle', ${historiqueCultures.annee_reference_controle}
                )
                ORDER BY ${historiqueCultures.annee_reference_controle} DESC, ${historiqueCultures.audit_date} DESC
              )
              FROM ${historiqueCultures}
              WHERE ${historiqueCultures.parcelle_id} = ${parcelles.id}
                AND ${historiqueCultures.intersection_ratio} >= 0.95
            ),
            '[]'::jsonb
          )
        )`
      })
      .from(parcelles)
      .leftJoin(
        parcellesControles,
        and(
          eq(parcellesControles.recordId, record.record_id),
          eq(parcellesControles.parcelleId, parcelles.id),
          sql`${parcellesControles.userId} = ${userId === null ? null : String(userId)}`
        )
      )
      .innerJoin(parcellaires, eq(parcellaires.recordId, parcelles.recordId))
      .where(and(eq(parcelles.recordId, record.record_id), isNull(parcelles.deletedAt)))
      .orderBy(asc(parcelles.createdAt))

    return { ...record, parcelles: rows }
  }

  return { ...record, parcelles: record?.parcelles ?? [] }
}

async function analyzeGeometries(
  tx: NodePgDatabase,
  inputs: Array<{ geometry: Polygon; commune: string | null | undefined }>
): Promise<GeometryAnalysis[]> {
  if (!inputs.length) return []

  const result = await tx.execute<GeometryAnalysis>(sql`
    WITH input AS MATERIALIZED (
      SELECT
        i.ord,
        ST_SetSRID(ST_GeomFromGeoJSON(i.value->'geometry'), 4326) AS original,
        NULLIF(i.value->>'commune', '') AS commune_code
      FROM jsonb_array_elements(${JSON.stringify(inputs)}::jsonb) WITH ORDINALITY AS i(value, ord)
    ),
    validated AS MATERIALIZED (
      SELECT
        ord,
        commune_code,
        original,
        CASE
          WHEN ST_IsValid(original) THEN original
          ELSE ST_MakeValid(original, 'method=structure')
        END AS valid
      FROM input
    ),
    largest AS MATERIALIZED (
      SELECT
        ord,
        commune_code,
        original,
        valid,
        CASE
          WHEN ST_GeometryType(valid) = 'ST_MultiPolygon' THEN (
            SELECT ST_GeometryN(valid, n)
            FROM generate_series(1, ST_NumGeometries(valid)) AS n
            ORDER BY ST_Area(ST_GeometryN(valid, n), true) DESC
            LIMIT 1
          )
          ELSE valid
        END AS fixed
      FROM validated
    ),
    statut AS MATERIALIZED (
      SELECT
        ord,
        commune_code,
        original,
        valid,
        fixed,
        CASE
          WHEN ST_IsValid(original) THEN 'ACCEPTE'
          WHEN fixed IS NULL OR ST_IsEmpty(fixed) THEN 'UNCORRECTABLE'
          WHEN ST_GeometryType(fixed) NOT IN ('ST_Polygon', 'ST_MultiPolygon') THEN 'UNCORRECTABLE'
          WHEN ABS(ST_Area(original, true) - ST_Area(fixed, true)) / 10000 >= 1
            OR ABS((ST_Area(original, true) - ST_Area(fixed, true)) / NULLIF(ST_Area(original, true) / 100, 0)) >= 1 THEN 'ACCEPTENONCORRIGE'
          ELSE 'CORRIGE'
        END AS statut
      FROM largest
    ),
    chosen AS MATERIALIZED (
      SELECT
        ord,
        commune_code,
        statut,
        valid,
        fixed
      FROM statut
    ),
    located AS MATERIALIZED (
      SELECT
        ord,
        commune_code,
        statut,
        valid,
        fixed,
        CASE WHEN statut = 'UNCORRECTABLE' THEN NULL ELSE NOT EXISTS(
          SELECT 1 FROM ${territoires} WHERE ST_Intersects(valid, ${territoires.geometry})
        ) END AS etranger
      FROM chosen
    )
    SELECT
      statut,
      etranger,
      CASE WHEN statut = 'CORRIGE' THEN ST_AsGeoJSON(fixed)::json END AS geometry,
      CASE WHEN statut = 'UNCORRECTABLE' OR etranger THEN NULL ELSE COALESCE(
        (SELECT ${communes.fid} FROM ${communes} WHERE ${communes.fid} = commune_code AND ${communes.active}
          AND (ST_Within(${communes.geometry}, valid) OR ST_Intersects(${communes.geometry}, valid)) LIMIT 1),
        ${communeLaPlusProche(sql`valid`)}
      ) END AS commune
    FROM located
    ORDER BY ord
  `)

  return result.rows
}

export {
  insertEvent,
  ensureOrganismeCertificateur,
  upsertMetadata,
  upsertCultures,
  upsertAnnotations,
  findCertificationStateAtAuditDate,
  findMatchingPreviousParcelles,
  copyParcellesFromPreviousRecord,
  findLastAuditedRecordId,
  markCertificationNotified,
  hasRecordForOc,
  upsertOperator,
  upsertParcelles,
  deleteMissingParcelles,
  findMixite,
  updateMixite,
  findRecords,
  findRecord,
  findRecordParcelles,
  analyzeGeometries
}
