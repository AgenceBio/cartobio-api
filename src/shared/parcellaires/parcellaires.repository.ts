import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, exists, gte, inArray, isNull, lt, lte, notExists, notInArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
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
import type { CartoBioAnnotation, CartoBioCulture, CartoBioFeatureInput, HistoryEntry } from '@agencebio/cartobio-types'
import type {
  DBOperatorRecord,
  DBOperatorRecordWithParcelles,
  DBParcelle,
  GeometryAnalysis,
  ParcelleRow,
  PreviousParcelle,
  RecordInput,
  RecordSummaryRow
} from './parcellaires.types.js'
import { MissingGeometryApiError } from '../errors.js'
import { getRandomFeatureId } from '../outputs/features.js'
import {
  annotationCodes,
  createParcelleAnnotationSchema,
  createParcelleSchema,
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
  definedOnly,
  eventTypes,
  INSERT_BATCH_SIZE,
  notInKeys,
  parcelleColumns,
  parcelleInsertValues,
  parcelleKey,
  toAnnotation,
  toCulture,
  toDBParcelle,
  parcelleUpdateSet,
  recordColumns,
  updatedValue
} from './parcellaires.utils.js'
import { areaHa, makeValid, wgs84FromGeoJSON } from '../../database/postgis.js'

type FeatureProperties = CartoBioFeatureInput['properties']

function statutImportGeom(statut: string | null | undefined): string {
  if (!statut) return 'ACCEPTE'
  return statut === 'ACCEPTENONCORRIGE' ? 'ACCEPTE_NON_CORRIGE' : statut
}

const surfaceCulture = (surface: unknown): string | null => {
  const value = String(surface ?? '').replace(',', '.')
  return /^\d+(\.\d+)?$/.test(value) ? value : null
}

const dateSemis = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null

export async function insertEvent(tx: NodePgDatabase, recordId: string, entry: HistoryEntry | null): Promise<void> {
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

export async function ensureOrganismeCertificateur(
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

export async function upsertMetadata(
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
    .values(createParcellaireMetadataSchema.parse({ recordId, ...values }))
    .onConflictDoUpdate({ target: parcellairesMetadata.recordId, set: values })
}

export async function upsertCultures(
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

export async function upsertAnnotations(
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

async function findCultures(
  executor: NodePgDatabase,
  keys: Array<{ recordId: string; parcelleId: string }>
): Promise<Map<string, CartoBioCulture[]>> {
  const byParcelle = new Map<string, CartoBioCulture[]>()
  if (keys.length === 0) return byParcelle

  const wanted = new Set(keys.map(({ recordId, parcelleId }) => parcelleKey(recordId, parcelleId)))
  const rows = await executor
    .select()
    .from(parcelleCultures)
    .where(
      and(
        inArray(parcelleCultures.recordId, [...new Set(keys.map(({ recordId }) => recordId))]),
        inArray(parcelleCultures.parcelleId, [...new Set(keys.map(({ parcelleId }) => parcelleId))])
      )
    )
    .orderBy(asc(parcelleCultures.position))

  for (const row of rows) {
    const key = parcelleKey(row.recordId, row.parcelleId)
    if (wanted.has(key)) byParcelle.set(key, [...(byParcelle.get(key) ?? []), toCulture(row)])
  }
  return byParcelle
}

async function findAnnotations(
  executor: NodePgDatabase,
  recordId: string,
  parcelleIds: string[]
): Promise<Map<string, CartoBioAnnotation[]>> {
  const byParcelle = new Map<string, CartoBioAnnotation[]>()
  if (parcelleIds.length === 0) return byParcelle

  const rows = await executor
    .select()
    .from(parcellesAnnotations)
    .where(and(eq(parcellesAnnotations.recordId, recordId), inArray(parcellesAnnotations.parcelleId, parcelleIds)))
    .orderBy(asc(parcellesAnnotations.createdAt))

  for (const row of rows) byParcelle.set(row.parcelleId, [...(byParcelle.get(row.parcelleId) ?? []), toAnnotation(row)])
  return byParcelle
}

async function withCulturesAndAnnotations(
  executor: NodePgDatabase,
  recordId: string,
  rows: ParcelleRow[]
): Promise<DBParcelle[]> {
  const ids = rows.map(({ id }) => id)
  const cultures = await findCultures(
    executor,
    ids.map((parcelleId) => ({ recordId, parcelleId }))
  )
  const annotations = await findAnnotations(executor, recordId, ids)

  return rows.map((row) =>
    toDBParcelle(row, cultures.get(parcelleKey(recordId, row.id)) ?? [], annotations.get(row.id) ?? [])
  )
}

async function findParcelles(tx: NodePgDatabase, recordId: string, ids: string[]): Promise<DBParcelle[]> {
  if (ids.length === 0) return []

  const rows = await tx
    .select(parcelleColumns)
    .from(parcelles)
    .leftJoin(communes, eq(communes.fid, parcelles.commune))
    .where(and(eq(parcelles.recordId, recordId), inArray(parcelles.id, ids)))

  return withCulturesAndAnnotations(
    tx,
    recordId,
    ids.flatMap((id) => rows.filter((row) => row.id === id))
  )
}

export async function hasRecordForOc(numeroBio: string | number, ocId: number): Promise<boolean> {
  const [row] = await db
    .select({ recordId: parcellaires.recordId })
    .from(parcellaires)
    .where(
      and(eq(parcellaires.numeroBio, Number(numeroBio)), eq(parcellaires.ocId, ocId), isNull(parcellaires.deletedAt))
    )
    .limit(1)
  return row !== undefined
}

export async function findCertificationStateAtAuditDate(
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
        eq(parcellaires.auditDate, auditDate),
        isNull(parcellaires.deletedAt)
      )
    )

  return row?.certification_state ?? null
}

export async function findMatchingPreviousParcelles(
  tx: NodePgDatabase,
  numerobio: string,
  previousRecordId: string,
  geometries: Array<CartoBioFeatureInput['geometry']>
): Promise<Array<PreviousParcelle | null>> {
  if (!geometries.length) return []

  const input = tx.$with('input', { ord: sql<number>`ord`.as('ord'), geom: sql`parcelle_geom`.as('parcelle_geom') })
    .as(sql`
      SELECT i.ord, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(i.value), 4326)) AS parcelle_geom
      FROM jsonb_array_elements(${JSON.stringify(geometries)}::jsonb) WITH ORDINALITY AS i(value, ord)
    `)

  const previousGeometry = makeValid(parcelles.geometry)
  const intersection = sql`ST_Area(ST_Intersection(${previousGeometry}, ${input.geom}))`

  const previous = tx
    .select({
      record_id: parcelles.recordId,
      id: parcelles.id,
      conversion_niveau: parcelles.conversionNiveau,
      engagement_date: parcelles.engagementDate,
      name: parcelles.name
    })
    .from(parcelles)
    .innerJoin(parcellaires, eq(parcellaires.recordId, parcelles.recordId))
    .where(
      and(
        eq(parcellaires.numeroBio, Number(numerobio)),
        eq(parcellaires.recordId, previousRecordId),
        isNull(parcellaires.deletedAt),
        isNull(parcelles.deletedAt),
        sql`${intersection} / (ST_Area(${previousGeometry}) / 100) > 99`,
        sql`${intersection} / (ST_Area(${input.geom}) / 100) > 99`
      )
    )
    .orderBy(desc(parcelles.createdAt))
    .limit(1)
    .as('previous')

  const rows = await tx
    .with(input)
    .select({
      record_id: previous.record_id,
      id: previous.id,
      conversion_niveau: previous.conversion_niveau,
      engagement_date: previous.engagement_date,
      name: previous.name
    })
    .from(input)
    .leftJoinLateral(previous, sql`true`)
    .orderBy(input.ord)

  const found = rows.flatMap(({ record_id: recordId, id }) =>
    recordId === null || id === null ? [] : [{ recordId, parcelleId: id }]
  )
  const cultures = await findCultures(tx, found)

  return rows.map(({ record_id: recordId, ...row }) =>
    recordId === null || row.id === null
      ? null
      : ({ ...row, cultures: cultures.get(parcelleKey(recordId, row.id)) ?? [] } as PreviousParcelle)
  )
}

export async function copyParcellesFromPreviousRecord(
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
                .select({ id: parcellairesEvenements.id })
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
                .select({ id: cpBase.id })
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

export async function findLastAuditedRecordId(numeroBio: string): Promise<string | null> {
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
      desc(eq(parcellaires.certificationEtat, certificationEtatEnumSchema.enum.CERTIFIED)),
      desc(parcellaires.auditDate)
    )
    .limit(1)

  return row?.recordId ?? null
}

export async function markCertificationNotified(tx: NodePgDatabase, recordId: string): Promise<void> {
  await tx
    .update(parcellaires)
    .set(updateParcellaireSchema.parse({ dateDerniereNotif: new Date() }))
    .where(eq(parcellaires.recordId, recordId))
}

export async function findRecord(tx: NodePgDatabase, recordId: string): Promise<DBOperatorRecord | null> {
  const [record] = await tx
    .select(recordColumns)
    .from(parcellaires)
    .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
    .where(and(eq(parcellaires.recordId, recordId), isNull(parcellaires.deletedAt)))
    .limit(1)

  return record ?? null
}

export async function upsertOperator(
  tx: NodePgDatabase,
  record: RecordInput,
  certificationState: CertificationState,
  historyEntry: HistoryEntry
): Promise<DBOperatorRecord> {
  await ensureOrganismeCertificateur(tx, record.oc_id, record.oc_label)

  const now = new Date()
  const auditDate = blankToNull(record.audit_date)
  const anneeReferenceControle = blankToNull(record.annee_reference_controle)
  const values = createParcellaireSchema.parse({
    numeroBio: Number(record.numerobio),
    ocId: record.oc_id ?? null,
    numeroClient: record.numero_client ?? null,
    certificationEtat: certificationState,
    certificationDateDebut: blankToNull(record.certification_date_debut),
    certificationDateFin: blankToNull(record.certification_date_fin),
    auditDate,
    auditNotesCertif: blankToNull(record.audit_notes),
    versionNom:
      blankToNull(record.version_name) ?? `Version créée le ${now.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`,
    anneeReferenceControle:
      anneeReferenceControle === null
        ? Number((auditDate ?? now.toISOString()).slice(0, 4))
        : Number(anneeReferenceControle)
  })
  const updates = updateParcellaireSchema.parse(
    definedOnly({
      ocId: record.oc_id ?? null,
      numeroClient: updatedValue(record.numero_client),
      certificationEtat: certificationState,
      certificationDateDebut: updatedValue(record.certification_date_debut),
      certificationDateFin: updatedValue(record.certification_date_fin),
      auditNotesCertif: updatedValue(record.audit_notes),
      versionNom: blankToNull(record.version_name) ?? undefined,
      anneeReferenceControle: anneeReferenceControle === null ? undefined : Number(anneeReferenceControle)
    })
  )

  const { recordId } = firstRow(
    await tx
      .insert(parcellaires)
      .values(values)
      .onConflictDoUpdate({
        target: [parcellaires.numeroBio, parcellaires.auditDate],
        targetWhere: isNull(parcellaires.deletedAt),
        set: { ...updates, updatedAt: now }
      })
      .returning({ recordId: parcellaires.recordId })
  )

  await upsertMetadata(tx, recordId, record.metadata)
  await insertEvent(tx, recordId, historyEntry)

  const saved = await findRecord(tx, recordId)
  if (!saved) throw new Error(`Parcellaire ${recordId} introuvable après son enregistrement`)
  return saved
}

export async function upsertParcelles(
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
    const etranger = properties.etranger ?? false
    const importSet = createParcelleSchema.pick({ statutImportGeom: true, attentePac: true }).parse(
      definedOnly({
        statutImportGeom: statutImportGeom(properties.statut_import_geom),
        attentePac: properties.attente_pac ?? undefined
      })
    )

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
      .values({ ...parcelleInsertValues(recordId, id, properties, geometry, etranger), ...importSet })
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

export async function deleteMissingParcelles(
  tx: NodePgDatabase,
  recordId: string,
  existing: Array<DBParcelle>
): Promise<void> {
  const ids = existing.map((parcelle) => parcelle.id)

  await tx
    .delete(parcelles)
    .where(and(eq(parcelles.recordId, recordId), ids.length > 0 ? notInArray(parcelles.id, ids) : undefined))
}

export async function findMixite(tx: NodePgDatabase, recordId: string): Promise<string | null> {
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
        notExists(
          tx
            .select({ id: parcelleCultures.id })
            .from(parcelleCultures)
            .where(
              and(
                eq(parcelleCultures.recordId, parcelles.recordId),
                eq(parcelleCultures.parcelleId, parcelles.id),
                inArray(parcelleCultures.cpf, ['01.99.10.1', '01.99.10.2'])
              )
            )
        )
      )
    )

  return row?.mixite ?? null
}

export async function updateMixite(tx: NodePgDatabase, recordId: string): Promise<void> {
  await tx
    .update(parcellaires)
    .set(updateParcellaireSchema.parse({ mixite: await findMixite(tx, recordId) }))
    .where(eq(parcellaires.recordId, recordId))
}

export async function findRecords(numeroBio: string | number): Promise<RecordSummaryRow[]> {
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

export async function findRecordParcelles(
  record: DBOperatorRecord,
  userId: number | null = null
): Promise<DBOperatorRecordWithParcelles> {
  if (record && !record.parcelles) {
    const dp = alias(parcelles, 'dp')
    const dpRecord = alias(parcellaires, 'dp_record')
    const r = alias(parcelles, 'r')
    const co = alias(parcellaires, 'co')

    const rows = await db
      .select(parcelleColumns)
      .from(parcelles)
      .leftJoin(communes, eq(communes.fid, parcelles.commune))
      .where(and(eq(parcelles.recordId, record.record_id), isNull(parcelles.deletedAt)))
      .orderBy(asc(parcelles.createdAt))

    const historique = await db
      .select({
        parcelleId: dp.id,
        recordId: r.recordId,
        id: r.id,
        conversionNiveau: r.conversionNiveau,
        anneeReferenceControle: co.anneeReferenceControle
      })
      .from(r)
      .innerJoin(dp, sql`ST_Intersects(${dp.geometry}, ${r.geometry})`)
      .innerJoin(dpRecord, eq(dpRecord.recordId, dp.recordId))
      .innerJoin(co, eq(r.recordId, co.recordId))
      .where(
        and(
          eq(dp.recordId, record.record_id),
          eq(co.certificationEtat, certificationEtatEnumSchema.enum.CERTIFIED),
          sql`ST_Isvalid(${r.geometry}) AND ST_Isvalid(${dp.geometry})`,
          lte(co.anneeReferenceControle, dpRecord.anneeReferenceControle),
          or(lt(co.auditDate, dpRecord.auditDate), isNull(dpRecord.auditDate)),
          eq(co.numeroBio, dpRecord.numeroBio),
          gte(co.anneeReferenceControle, new Date().getUTCFullYear() - 3),
          isNull(r.deletedAt),
          isNull(co.deletedAt),
          sql`ST_Area(ST_Intersection(${dp.geometry}, ${r.geometry})) / ST_Area(${dp.geometry}) >= 0.95`
        )
      )
      .orderBy(desc(co.anneeReferenceControle), desc(co.auditDate))

    const controlees =
      userId === null
        ? new Set<string>()
        : new Set(
            (
              await db
                .select({ parcelleId: parcellesControles.parcelleId })
                .from(parcellesControles)
                .where(
                  and(eq(parcellesControles.recordId, record.record_id), eq(parcellesControles.userId, String(userId)))
                )
            ).map(({ parcelleId }) => parcelleId)
          )

    const parcellesAvecCultures = await withCulturesAndAnnotations(db, record.record_id, rows)
    const culturesHistoriques = await findCultures(
      db,
      historique.map(({ recordId, id }) => ({ recordId, parcelleId: id }))
    )

    return {
      ...record,
      parcelles: parcellesAvecCultures.map((parcelle) => ({
        ...parcelle,
        controlee: controlees.has(parcelle.id),
        historique_cultures: [
          {
            cultures: parcelle.cultures,
            conversion_niveau: parcelle.conversion_niveau,
            annee_controle: record.annee_reference_controle
          },
          ...historique
            .filter(({ parcelleId }) => parcelleId === parcelle.id)
            .map(({ recordId, id, conversionNiveau, anneeReferenceControle }) => ({
              cultures: culturesHistoriques.get(parcelleKey(recordId, id)) ?? [],
              conversion_niveau: conversionNiveau,
              annee_controle: anneeReferenceControle
            }))
        ]
      }))
    }
  }

  return { ...record, parcelles: record?.parcelles ?? [] }
}

export async function analyzeGeometries(
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
