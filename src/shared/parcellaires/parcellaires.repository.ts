import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Polygon } from 'geojson'

import { db } from '../../database/database.js'
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
import type { DBOperatorRecord, DBOperatorRecordWithParcelles, DBParcelle, NormalizedRecord, HistoryEntry, CartoBioFeatureInput } from '@agencebio/cartobio-types'
import { MissingGeometryApiError } from '../errors.js'
import { getRandomFeatureId } from '../outputs/features.js'
import { annotationCodes } from '../../database/validations/parcelles.js'
import { blankToNull, coalesceBlank, culturesJson, eventTypes, parcelleColumns, recordColumns } from './parcellaires.utils.js'
import type { GeometryFixAnalysis, RecordSummaryRow } from './parcellaires.types.js'

type FeatureProperties = CartoBioFeatureInput['properties']

const geometryFromGeoJSON = (geometry: unknown): SQL => sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`

const surfaceHa = (geometry: SQL): SQL => sql`round((ST_Area(${geometry}::geography) / 10000)::numeric, 4)`

const statutImportGeom = (statut: string | null | undefined): SQL => sql`${statut === 'ACCEPTENONCORRIGE' ? 'ACCEPTE_NON_CORRIGE' : statut ?? null}::cartobio.statut_import_geom`

const surfaceCulture = (surface: unknown): string | null => {
  const value = String(surface ?? '').replace(',', '.')
  return /^\d+(\.\d+)?$/.test(value) ? value : null
}

const dateSemis = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null

async function insertEvent (tx: NodePgDatabase, recordId: string, entry: HistoryEntry | null): Promise<void> {
  if (!entry) return

  await tx.insert(parcellairesEvenements).values({
    recordId,
    type: eventTypes[entry.type],
    certificationEtat: (entry.state as CertificationState | undefined) ?? null,
    date: new Date(entry.date),
    userId: entry.user?.id != null ? String(entry.user.id) : null,
    userRole: entry.user?.mainGroup?.nom ?? null,
    parcellesId: entry.featureIds ? entry.featureIds.map((id) => (id == null ? null : String(id))) as string[] : null,
    description: entry.description ?? null,
    metadata: entry.metadata ?? null
  })
}

async function ensureOrganismeCertificateur (tx: NodePgDatabase, ocId: number | string | null | undefined, ocLabel: string | null | undefined): Promise<void> {
  if (ocId == null) return

  await tx
    .insert(organismeCertificateur)
    .values({ id: String(ocId), label: ocLabel || String(ocId) })
    .onConflictDoNothing()
}

async function upsertMetadata (tx: NodePgDatabase, recordId: string, metadata: Record<string, unknown> | null | undefined): Promise<void> {
  const meta = metadata ?? {}
  const sourceLastUpdate = typeof meta.sourceLastUpdate === 'string' && !Number.isNaN(Date.parse(meta.sourceLastUpdate)) ? new Date(meta.sourceLastUpdate) : null
  const year = (value: unknown): number | null => /^\d{4}$/.test(String(value ?? '')) ? Number(value) : null
  const values = {
    source: typeof meta.source === 'string' ? meta.source : null,
    sourceUpdatedAt: sourceLastUpdate,
    provenance: typeof meta.provenance === 'string' ? meta.provenance : null,
    campagne: year(meta.campagne),
    numeroPacage: meta.pacage == null ? null : String(meta.pacage),
    anneeAssolement: year(meta.anneeAssolement),
    copyOf: meta.copy_of == null ? null : String(meta.copy_of),
    warnings: meta.warnings ?? null
  }

  await tx
    .insert(parcellairesMetadata)
    .values({ recordId, ...values })
    .onConflictDoUpdate({ target: parcellairesMetadata.recordId, set: values })
}

async function upsertCultures (tx: NodePgDatabase, recordId: string, parcelleId: string, cultures: FeatureProperties['cultures'] | null | undefined): Promise<void> {
  if (!cultures) return

  const parcelle = and(eq(parcelleCultures.recordId, recordId), eq(parcelleCultures.parcelleId, parcelleId))
  const values = cultures.map((culture, position) => ({
    id: culture.id ?? randomUUID(),
    recordId,
    parcelleId,
    cpf: blankToNull(culture.CPF),
    codeCultureImport: blankToNull(culture.TYPE),
    surface: surfaceCulture(culture.surface),
    unit: blankToNull(culture.unit),
    variete: blankToNull(culture.variete),
    dateSemis: dateSemis(culture.date_semis),
    commentaire: blankToNull((culture as { commentaire?: string | null }).commentaire),
    position
  }))

  await tx
    .delete(parcelleCultures)
    .where(and(parcelle, values.length > 0 ? notInArray(parcelleCultures.id, values.map(({ id }) => id)) : undefined))

  if (values.length === 0) return

  await tx
    .insert(parcelleCultures)
    .values(values)
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

async function upsertAnnotations (tx: NodePgDatabase, recordId: string, parcelleId: string, annotations: FeatureProperties['annotations'] | null | undefined): Promise<void> {
  if (!annotations) return

  const parcelle = and(eq(parcellesAnnotations.recordId, recordId), eq(parcellesAnnotations.parcelleId, parcelleId))
  const kept = (annotations as Array<{ id?: unknown; code?: unknown; date?: unknown; metadata?: unknown }>)
    .filter((annotation) => Object.hasOwn(annotationCodes, String(annotation.code)))
  const values = kept
    .map((annotation) => ({
      id: typeof annotation.id === 'string' ? annotation.id : randomUUID(),
      recordId,
      parcelleId,
      typeAnnot: annotationCodes[String(annotation.code)],
      createdAt: typeof annotation.date === 'string' && !Number.isNaN(Date.parse(annotation.date)) ? new Date(annotation.date) : new Date(),
      metadata: annotation.metadata ?? null
    }))

  await tx
    .delete(parcellesAnnotations)
    .where(and(parcelle, values.length > 0 ? notInArray(parcellesAnnotations.id, values.map(({ id }) => id)) : undefined))

  if (values.length === 0) return

  await tx
    .insert(parcellesAnnotations)
    .values(values)
    .onConflictDoUpdate({
      target: [parcellesAnnotations.recordId, parcellesAnnotations.parcelleId, parcellesAnnotations.id],
      set: {
        typeAnnot: sql`excluded.type_annot`,
        createdAt: sql`excluded.created_at`,
        metadata: sql`excluded.metadata`
      }
    })
}

async function findParcelles (tx: NodePgDatabase, recordId: string, ids: string[]): Promise<DBParcelle[]> {
  if (ids.length === 0) return []

  const rows = await tx
    .select(parcelleColumns)
    .from(parcelles)
    .where(and(eq(parcelles.recordId, recordId), inArray(parcelles.id, ids)))

  return ids.flatMap((id) => rows.filter((row) => row.id === id)) as unknown as DBParcelle[]
}

async function findCertificationStateAtAuditDate (tx: NodePgDatabase, numerobio: string | undefined, auditDate: string | null | undefined): Promise<string | null> {
  if (!auditDate) return null

  const [row] = await tx
    .select({ certification_state: parcellaires.certificationEtat })
    .from(parcellaires)
    .where(and(
      eq(parcellaires.numeroBio, Number(numerobio)),
      sql`${parcellaires.auditDate} = ${auditDate}::date`,
      isNull(parcellaires.deletedAt)
    ))

  return row?.certification_state ?? null
}

async function findMatchingPreviousParcelle (tx: NodePgDatabase, numerobio: string, previousRecordId: string, geometry: CartoBioFeatureInput['geometry']): Promise<DBParcelle | null> {
  const input = sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326))`
  const intersection = sql`ST_area(ST_Intersection(ST_MakeValid(${parcelles.geometry}), ${input}))`

  const [row] = await tx
    .select({
      id: parcelles.id,
      cultures: culturesJson(parcelles.recordId, parcelles.id),
      conversion_niveau: parcelles.conversionNiveau,
      engagement_date: parcelles.engagementDate,
      name: parcelles.name
    })
    .from(parcelles)
    .innerJoin(parcellaires, eq(parcellaires.recordId, parcelles.recordId))
    .where(and(
      eq(parcellaires.numeroBio, Number(numerobio)),
      eq(parcellaires.recordId, previousRecordId),
      isNull(parcellaires.deletedAt),
      isNull(parcelles.deletedAt),
      sql`${intersection} / (ST_area(ST_MakeValid(${parcelles.geometry})) / 100) > 99`,
      sql`${intersection} / (ST_area(${input}) / 100) > 99`
    ))
    .orderBy(desc(parcelles.createdAt))
    .limit(1)

  return (row ?? null) as unknown as DBParcelle | null
}

async function copyParcellesFromPreviousRecord (tx: NodePgDatabase, recordId: string, numerobio: string, previousRecordId: string): Promise<Array<DBParcelle>> {
  const copied = await tx.execute<{ id: string }>(sql`
    INSERT INTO ${parcelles}
      (record_id, id, geometry, surface_ha, commune, conversion_niveau, engagement_date, auditeur_notes_parcelles,
        name, reference_cadastre, code_culture_pac, code_precision_pac)
    SELECT ${recordId}, ${parcelles.id}, ${parcelles.geometry}, ${parcelles.surfaceHa}, ${parcelles.commune}, ${parcelles.conversionNiveau},
      ${parcelles.engagementDate}, NULL, ${parcelles.name}, ${parcelles.referenceCadastre}, ${parcelles.codeCulturePac}, ${parcelles.codePrecisionPac}
    FROM ${parcelles}
    JOIN ${parcellaires} ON ${eq(parcellaires.recordId, parcelles.recordId)}
    WHERE ${parcellaires.recordId} = ${previousRecordId}
      AND ${parcellaires.numeroBio} = ${Number(numerobio)}
      AND ${parcellaires.deletedAt} IS NULL
      AND ${parcelles.deletedAt} IS NULL
      AND EXISTS (
        SELECT 1 FROM ${parcellairesEvenements}
        WHERE ${eq(parcellairesEvenements.recordId, parcellaires.recordId)}
          AND ${parcellairesEvenements.type} = 'FEATURE_COLLECTION_CREATE'
          AND ${parcellairesEvenements.certificationEtat} = 'OPERATOR_DRAFT'
          AND NOT array_to_json(${parcellairesEvenements.parcellesId})::text ~ ${parcelles.id}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${parcelles} cp_base
        WHERE cp_base.record_id = ${recordId}
          AND ST_Intersects(cp_base.geometry, ${parcelles.geometry})
          AND (
            ST_Area(ST_Intersection(cp_base.geometry, ${parcelles.geometry})) / ST_Area(cp_base.geometry) > 0.5
            OR ST_Area(ST_Intersection(cp_base.geometry, ${parcelles.geometry})) / ST_Area(${parcelles.geometry}) > 0.5
          )
          AND cp_base.deleted_at IS NULL
      )
    ON CONFLICT (record_id, id) DO NOTHING
    RETURNING id
  `)

  const ids = copied.rows.map(({ id }) => id)

  if (ids.length > 0) {
    await tx.execute(sql`
      INSERT INTO ${parcelleCultures} (id, record_id, parcelle_id, cpf, code_culture_import, surface, unit, variete, date_semis, commentaire, position)
      SELECT id, ${recordId}, parcelle_id, cpf, code_culture_import, surface, unit, variete, date_semis, commentaire, position
      FROM ${parcelleCultures}
      WHERE record_id = ${previousRecordId} AND ${inArray(parcelleCultures.parcelleId, ids)}
    `)
  }

  return findParcelles(tx, recordId, ids)
}

async function markCertificationNotified (tx: NodePgDatabase, recordId: string): Promise<void> {
  await tx
    .update(parcellaires)
    .set({ dateDerniereNotif: sql`now()` })
    .where(eq(parcellaires.recordId, recordId))
}

async function findRecord (recordId: string, tx: NodePgDatabase = db): Promise<DBOperatorRecord | null> {
  const [record] = await tx
    .select(recordColumns)
    .from(parcellaires)
    .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
    .where(eq(parcellaires.recordId, recordId))
    .limit(1)

  return record ?? null
}

async function upsertOperator (tx: NodePgDatabase, record: Omit<Partial<NormalizedRecord>, 'parcelles'>, certificationState: CertificationState, historyEntry: HistoryEntry): Promise<DBOperatorRecord> {
  await ensureOrganismeCertificateur(tx, record.oc_id, (record as { oc_label?: string | null }).oc_label)

  const auditDate = sql`nullif(${record.audit_date ?? null}::text, '')::date`
  const anneeReferenceControle = sql`nullif(${record.annee_reference_controle == null ? null : String(record.annee_reference_controle)}::text, '')::int`

  const [{ recordId }] = await tx
    .insert(parcellaires)
    .values({
      numeroBio: Number(record.numerobio),
      ocId: record.oc_id == null ? null : String(record.oc_id),
      createdAt: sql`now()`,
      certificationEtat: certificationState,
      certificationDateDebut: sql`nullif(${record.certification_date_debut ?? null}::text, '')::date`,
      certificationDateFin: sql`nullif(${record.certification_date_fin ?? null}::text, '')::date`,
      auditDate,
      auditNotesCertif: blankToNull(record.audit_notes),
      versionNom: sql`COALESCE(${blankToNull(record.version_name)}::text, 'Version créée le ' || to_char(now(), 'DD/MM/YYYY'))`,
      anneeReferenceControle: sql`COALESCE(${anneeReferenceControle}, DATE_PART('year', COALESCE(${auditDate}, NOW())))`
    })
    .onConflictDoUpdate({
      target: [parcellaires.numeroBio, parcellaires.auditDate],
      targetWhere: sql`${parcellaires.deletedAt} IS NULL`,
      set: {
        ocId: record.oc_id == null ? null : String(record.oc_id),
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

  await upsertMetadata(tx, recordId, record.metadata)
  await insertEvent(tx, recordId, historyEntry)

  return (await findRecord(recordId, tx)) as DBOperatorRecord
}

async function upsertParcelles (tx: NodePgDatabase, recordId: string, features: Array<CartoBioFeatureInput>): Promise<Array<DBParcelle>> {
  const result: DBParcelle[] = []
  for (const feature of features) {
    const properties = feature.properties
    const id = String(feature.id || getRandomFeatureId())

    if (!feature.geometry) {
      const updated = await tx
        .update(parcelles)
        .set({
          commune: coalesceBlank(properties.COMMUNE, parcelles.commune),
          conversionNiveau: properties.conversion_niveau === ''
            ? sql`NULL`
            : sql`coalesce(${properties.conversion_niveau ?? null}::cartobio.conversion_niveau, ${parcelles.conversionNiveau})`,
          engagementDate: sql`nullif(coalesce(${properties.engagement_date ?? null}::text, ${parcelles.engagementDate}::text), '')::date`,
          commentaireOperateur: coalesceBlank(properties.commentaires, parcelles.commentaireOperateur),
          auditeurNotesParcelles: coalesceBlank(properties.auditeur_notes, parcelles.auditeurNotesParcelles),
          updatedAt: sql`now()`,
          name: coalesceBlank(properties.NOM, parcelles.name),
          numeroPacage: coalesceBlank(properties.PACAGE, parcelles.numeroPacage),
          numeroIlotPac: coalesceBlank(properties.NUMERO_I, parcelles.numeroIlotPac, 'smallint'),
          numeroParcellesPac: coalesceBlank(properties.NUMERO_P, parcelles.numeroParcellesPac, 'smallint'),
          referenceCadastre: sql`coalesce(${properties.cadastre ?? null}::text[], ${parcelles.referenceCadastre})`,
          codeCulturePac: coalesceBlank(properties.TYPE, parcelles.codeCulturePac),
          codePrecisionPac: coalesceBlank(properties.CODE_VAR, parcelles.codePrecisionPac),
          etranger: sql`coalesce(${properties.etranger ?? false}::boolean, ${parcelles.etranger})`,
          statutImportGeom: sql`coalesce(${statutImportGeom(properties.statut_import_geom || 'ACCEPTE')}, ${parcelles.statutImportGeom})`,
          attentePac: sql`coalesce(${properties.attente_pac ?? null}::boolean, ${parcelles.attentePac})`
        })
        .where(and(eq(parcelles.recordId, recordId), eq(parcelles.id, id)))
        .returning({ id: parcelles.id })

      if (!updated.length) {
        throw new MissingGeometryApiError('Impossible de créer une parcelle sans donnée géographique.')
      }

      await upsertCultures(tx, recordId, id, properties.cultures)
      await upsertAnnotations(tx, recordId, id, properties.annotations)
      result.push(...await findParcelles(tx, recordId, [id]))
      continue
    }

    const geometry = geometryFromGeoJSON(feature.geometry)

    await tx
      .insert(parcelles)
      .values({
        recordId,
        id,
        geometry,
        surfaceHa: surfaceHa(geometry),
        commune: blankToNull(properties.COMMUNE),
        conversionNiveau: sql`${properties.conversion_niveau || null}::cartobio.conversion_niveau`,
        engagementDate: sql`NULLIF(${properties.engagement_date ?? null}::text, '')::date`,
        commentaireOperateur: blankToNull(properties.commentaires),
        auditeurNotesParcelles: blankToNull(properties.auditeur_notes),
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
        name: blankToNull(properties.NOM),
        numeroPacage: blankToNull(properties.PACAGE),
        numeroIlotPac: sql`${blankToNull(properties.NUMERO_I)}::smallint`,
        numeroParcellesPac: sql`${blankToNull(properties.NUMERO_P)}::smallint`,
        referenceCadastre: sql`${properties.cadastre ?? null}::text[]`,
        codeCulturePac: blankToNull(properties.TYPE),
        codePrecisionPac: blankToNull(properties.CODE_VAR),
        etranger: properties.etranger ?? false,
        statutImportGeom: statutImportGeom(properties.statut_import_geom || 'ACCEPTE'),
        attentePac: sql`COALESCE(${properties.attente_pac ?? null}::boolean, false)`
      })
      .onConflictDoUpdate({
        target: [parcelles.recordId, parcelles.id],
        set: {
          geometry,
          surfaceHa: surfaceHa(geometry),
          commune: coalesceBlank(properties.COMMUNE, parcelles.commune),
          conversionNiveau: properties.conversion_niveau === ''
            ? sql`NULL`
            : sql`COALESCE(${properties.conversion_niveau ?? null}::cartobio.conversion_niveau, ${parcelles.conversionNiveau})`,
          engagementDate: sql`nullif(coalesce(${properties.engagement_date ?? null}::text, ${parcelles.engagementDate}::text), '')::date`,
          commentaireOperateur: coalesceBlank(properties.commentaires, parcelles.commentaireOperateur),
          auditeurNotesParcelles: coalesceBlank(properties.auditeur_notes, parcelles.auditeurNotesParcelles),
          updatedAt: sql`now()`,
          name: coalesceBlank(properties.NOM, parcelles.name),
          numeroPacage: coalesceBlank(properties.PACAGE, parcelles.numeroPacage),
          numeroIlotPac: coalesceBlank(properties.NUMERO_I, parcelles.numeroIlotPac, 'smallint'),
          numeroParcellesPac: coalesceBlank(properties.NUMERO_P, parcelles.numeroParcellesPac, 'smallint'),
          referenceCadastre: sql`COALESCE(${properties.cadastre ?? null}::text[], ${parcelles.referenceCadastre})`,
          codeCulturePac: coalesceBlank(properties.TYPE, parcelles.codeCulturePac),
          codePrecisionPac: coalesceBlank(properties.CODE_VAR, parcelles.codePrecisionPac),
          etranger: sql`COALESCE(${properties.etranger ?? false}::boolean, ${parcelles.etranger})`,
          statutImportGeom: sql`COALESCE(${statutImportGeom(properties.statut_import_geom || 'ACCEPTE')}, ${parcelles.statutImportGeom})`,
          attentePac: sql`COALESCE(${properties.attente_pac ?? null}::boolean, ${parcelles.attentePac})`
        }
      })

    await upsertCultures(tx, recordId, id, properties.cultures)
    await upsertAnnotations(tx, recordId, id, properties.annotations)
    result.push(...await findParcelles(tx, recordId, [id]))
  }

  return result
}

async function deleteMissingParcelles (tx: NodePgDatabase, recordId: string, existing: Array<DBParcelle>): Promise<void> {
  const ids = existing.map((parcelle) => parcelle.id)

  await tx
    .delete(parcelles)
    .where(and(eq(parcelles.recordId, recordId), ids.length > 0 ? notInArray(parcelles.id, ids) : undefined))
}

async function updateMixite (tx: NodePgDatabase, recordId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE ${parcellaires}
    SET mixite = sub.mixite
    FROM (
      SELECT
        co.record_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE cp.conversion_niveau = 'AB') = COUNT(*)
            THEN 'AB'
          WHEN COUNT(*) FILTER (WHERE cp.conversion_niveau IN ('C1','C2','C3','AB')) = COUNT(*)
            THEN 'ABCONV'
          WHEN COUNT(*) FILTER (WHERE cp.conversion_niveau = 'CONV') > 0
            THEN 'MIXTE'
          ELSE NULL
        END::cartobio.mixite_type AS mixite
      FROM ${parcellaires} co
      LEFT JOIN ${parcelles} cp ON cp.record_id = co.record_id
      WHERE co.record_id = ${recordId} AND NOT EXISTS (
        SELECT 1
        FROM ${parcelleCultures} pc
        WHERE pc.record_id = cp.record_id
          AND pc.parcelle_id = cp.id
          AND pc.cpf IN ('01.99.10.1', '01.99.10.2'))
      GROUP BY co.record_id
    ) sub
    WHERE ${parcellaires.recordId} = sub.record_id
  `)
}

async function findRecords (numeroBio: string | number): Promise<RecordSummaryRow[]> {
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
    .leftJoin(parcelles, eq(parcellaires.recordId, parcelles.recordId))
    .where(and(
      eq(parcellaires.numeroBio, Number(numeroBio)),
      isNull(parcellaires.deletedAt),
      isNull(parcelles.deletedAt)
    ))
    .groupBy(parcellaires.recordId, parcellairesMetadata.recordId)
    .orderBy(
      sql`COALESCE(${parcellaires.certificationDateDebut}, ${parcellaires.auditDate}, ${parcellaires.createdAt}) DESC`,
      sql`COALESCE(${parcellaires.auditDate}, ${parcellaires.createdAt}) DESC`
    )

  return rows as unknown as RecordSummaryRow[]
}

async function findRecordParcelles (record: DBOperatorRecord, userId: number | null = null): Promise<DBOperatorRecordWithParcelles> {
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
          intersection_ratio: sql<number>`ST_Area(ST_Intersection(${dp.geometry}, ${r.geometry})) / ST_Area(${dp.geometry})`.as('intersection_ratio')
        })
        .from(r)
        .innerJoin(dp, sql`ST_Intersects(${dp.geometry}, ${r.geometry})`)
        .innerJoin(dpRecord, eq(dpRecord.recordId, dp.recordId))
        .innerJoin(co, eq(r.recordId, co.recordId))
        .where(and(
          eq(dp.recordId, record.record_id),
          sql`${co.certificationEtat} = 'CERTIFIED'`,
          sql`ST_Isvalid(${r.geometry}) AND ST_Isvalid(${dp.geometry})`,
          sql`${co.anneeReferenceControle} <= ${dpRecord.anneeReferenceControle}`,
          sql`(${co.auditDate} < ${dpRecord.auditDate} OR ${dpRecord.auditDate} IS NULL)`,
          eq(co.numeroBio, dpRecord.numeroBio),
          sql`${co.anneeReferenceControle} >= EXTRACT(YEAR FROM CURRENT_DATE) - 3`,
          isNull(r.deletedAt),
          isNull(co.deletedAt)
        ))
    )

    const rows = await db
      .with(historiqueCultures)
      .select({
        ...parcelleColumns,
        controlee: sql<boolean>`${parcellesControles.parcelleId} IS NOT NULL`,
        historique_cultures: sql`(
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
      .leftJoin(parcellesControles, and(
        eq(parcellesControles.recordId, record.record_id),
        eq(parcellesControles.parcelleId, parcelles.id),
        sql`${parcellesControles.userId} = ${userId === null ? null : String(userId)}`
      ))
      .innerJoin(parcellaires, eq(parcellaires.recordId, parcelles.recordId))
      .where(and(eq(parcelles.recordId, record.record_id), isNull(parcelles.deletedAt)))
      .orderBy(asc(parcelles.createdAt))

    return { ...record, parcelles: rows as unknown as DBParcelle[] }
  }

  return { ...record, parcelles: record?.parcelles ?? [] }
}

async function analyzeGeometryFix (geometry: Polygon): Promise<GeometryFixAnalysis> {
  const result = await db.execute<GeometryFixAnalysis>(sql`
    WITH input AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326) AS geom
    ),
    validated AS (
      SELECT
        geom AS original,
        CASE
          WHEN ST_IsValid(geom) THEN geom
          ELSE ST_MakeValid(geom, 'method=structure')
        END AS valid
      FROM input
    ),
    largest AS (
      SELECT
        original,
        valid,
        CASE
          WHEN ST_GeometryType(valid) = 'ST_MultiPolygon' THEN (
            SELECT ST_GeometryN(valid, i)
            FROM generate_series(1, ST_NumGeometries(valid)) AS i
            ORDER BY ST_Area(ST_GeometryN(valid, i), true) DESC
            LIMIT 1
          )
          ELSE valid
        END AS fixed
      FROM validated
    )
    SELECT
      ST_IsValid(original)                                                        AS already_valid,
      ST_GeometryType(fixed) IN ('ST_Polygon', 'ST_MultiPolygon')                AS is_polygon,
      ABS(ST_Area(original, true) - ST_Area(fixed, true)) / 10000                AS diff_ha,
      ABS(
        (ST_Area(original, true) - ST_Area(fixed, true))
        / NULLIF(ST_Area(original, true) / 100, 0)
      )                                                                           AS diff_pct,
      ST_AsGeoJSON(fixed)::json                                                   AS geometry
    FROM largest
  `)

  return result.rows[0]
}

async function isEtranger (geometry: Polygon): Promise<boolean> {
  const result = await db.execute<{ etranger: boolean }>(sql`
    SELECT NOT EXISTS(
      SELECT ${territoires.fid} FROM ${territoires}
      WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326), ${territoires.geometry})
    ) AS etranger
  `)

  return result.rows[0].etranger
}

async function communeExists (geometry: Polygon, code: string): Promise<boolean> {
  const input = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`
  const [row] = await db
    .select({ fid: communes.fid })
    .from(communes)
    .where(and(
      eq(communes.fid, code),
      eq(communes.active, true),
      sql`(ST_Within(${communes.geometry}, ${input}) OR ST_Intersects(${communes.geometry}, ${input}))`
    ))
    .limit(1)

  return row !== undefined
}

async function findCommune (geometry: Polygon, code: string | null = null): Promise<string | null> {
  const input = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`

  if (code) {
    const prefilter = await db
      .select({ code: communes.fid })
      .from(communes)
      .where(and(eq(communes.fid, code), eq(communes.active, true), sql`ST_Within(${input}, ${communes.geometry})`))

    if (prefilter.length > 0) return prefilter[0].code
  }

  const intersecting = await db
    .select({ code: communes.fid })
    .from(communes)
    .where(and(sql`ST_Intersects(${input}, ${communes.geometry})`, eq(communes.active, true)))
    .limit(1)

  if (intersecting.length > 0) return intersecting[0].code

  const nearest = await db
    .select({ code: communes.fid })
    .from(communes)
    .where(eq(communes.active, true))
    .orderBy(sql`ST_Distance(${input}, ${communes.geometry})`)
    .limit(1)

  return nearest[0].code ?? null
}

export {
  insertEvent,
  ensureOrganismeCertificateur,
  upsertMetadata,
  upsertCultures,
  upsertAnnotations,
  findParcelles,
  findCertificationStateAtAuditDate,
  findMatchingPreviousParcelle,
  copyParcellesFromPreviousRecord,
  markCertificationNotified,
  upsertOperator,
  upsertParcelles,
  deleteMissingParcelles,
  updateMixite,
  findRecords,
  findRecord,
  findRecordParcelles,
  analyzeGeometryFix,
  isEtranger,
  communeExists,
  findCommune
}
