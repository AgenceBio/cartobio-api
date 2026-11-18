import { SQL, and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DBOperatorRecord, FeatureInput, FeaturePropertiesInput, HistoryEntry } from '@agencebio/cartobio-types'
import { db } from '../../database/database.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { parcellaires, parcelles, parcellesControles } from '../../database/schema/index.js'
import {
  ensureOrganismeCertificateur,
  findRecord,
  insertEvent,
  upsertAnnotations,
  upsertCultures
} from '../../shared/parcellaires/parcellaires.repository.js'
import { blankToNull } from '../../shared/parcellaires/parcellaires.utils.js'
import { featureUpdateSet, geometryInput, mixiteParcelles, recordColumnsByLegacyName } from './audits.utils.js'

type FeatureId = string | number

async function deleteRecord(recordId: string): Promise<void> {
  await db.update(parcellaires).set({ deletedAt: sql`now()` }).where(eq(parcellaires.recordId, recordId))
}
async function markFeatureControlled(recordId: string, id: FeatureId, userId: number): Promise<void> {
  await db
    .insert(parcellesControles)
    .values({ recordId, parcelleId: String(id), userId: String(userId) })
    .onConflictDoNothing({ target: [parcellesControles.recordId, parcellesControles.parcelleId, parcellesControles.userId] })
}
async function markFeatureUncontrolled(recordId: string, id: FeatureId, userId: number): Promise<void> {
  await db
    .delete(parcellesControles)
    .where(and(
      eq(parcellesControles.recordId, recordId),
      eq(parcellesControles.parcelleId, String(id)),
      eq(parcellesControles.userId, String(userId))
    ))
}
async function findMixite(recordId: string): Promise<string | null> {
  const [row] = await db
    .select({ mixite: mixiteParcelles })
    .from(parcelles)
    .where(and(eq(parcelles.recordId, recordId), isNull(parcelles.deletedAt)))
  return row?.mixite ?? null
}
async function updateAuditRecord(
  recordId: string,
  changes: Record<string, unknown>,
  historyEntry: HistoryEntry | null
): Promise<DBOperatorRecord[]> {
  const set: Record<string, SQL> = {}
  for (const [field, value] of Object.entries(changes)) {
    if (field === 'oc_label') continue
    const column = recordColumnsByLegacyName[field]
    if (!column) throw new Error(`column "${field}" of relation "parcellaires" does not exist`)
    const isBlank = value != null && blankToNull(value) === null
    if (isBlank && column === 'versionNom') continue
    set[column] = value instanceof SQL ? value : sql`${isBlank ? null : value ?? null}`
  }

  return db.transaction(async (tx) => {
    if (changes.oc_id != null) {
      await ensureOrganismeCertificateur(tx, changes.oc_id as number, changes.oc_label as string | null | undefined)
    }
    await tx.update(parcellaires).set(set).where(eq(parcellaires.recordId, recordId))
    await insertEvent(tx, recordId, historyEntry)
    const record = await findRecord(recordId, tx)
    return record ? [record] : []
  })
}
async function setOperatorUpdatedAt(
  tx: NodePgDatabase,
  recordId: string,
  historyEntry: HistoryEntry | null,
  ocId: number | null,
  ocLabel: string | null
): Promise<DBOperatorRecord[]> {
  const [current] = await tx
    .select({ ocId: parcellaires.ocId })
    .from(parcellaires)
    .where(eq(parcellaires.recordId, recordId))
  if (current && current.ocId === null && ocId !== null) {
    await ensureOrganismeCertificateur(tx, ocId, ocLabel)
  }
  await tx
    .update(parcellaires)
    .set({
      updatedAt: sql`now()`,
      ocId: sql`coalesce(${parcellaires.ocId}, ${ocId === null ? null : String(ocId)})`
    })
    .where(eq(parcellaires.recordId, recordId))
  if (current) await insertEvent(tx, recordId, historyEntry)
  const record = await findRecord(recordId, tx)
  return record ? [record] : []
}
async function patchFeature(tx: NodePgDatabase, recordId: string, featureId: FeatureId, feature: FeatureInput): Promise<void> {
  const properties = feature.properties ?? {}
  const updated = await tx
    .update(parcelles)
    .set(featureUpdateSet(properties, feature.geometry))
    .where(and(eq(parcelles.recordId, recordId), eq(parcelles.id, String(featureId))))
    .returning({ id: parcelles.id })
  if (updated.length) {
    await upsertCultures(tx, recordId, String(featureId), properties.cultures)
    await upsertAnnotations(tx, recordId, String(featureId), properties.annotations)
  }
}
async function updateFeature(
  tx: NodePgDatabase,
  recordId: string,
  featureId: FeatureId,
  properties: FeaturePropertiesInput,
  geometry: FeatureInput['geometry']
): Promise<void> {
  const updated = await tx
    .update(parcelles)
    .set({
      ...featureUpdateSet(properties, geometry),
      attentePac: sql`coalesce(${properties.attente_pac ?? null}::boolean, ${parcelles.attentePac})`
    })
    .where(and(eq(parcelles.recordId, recordId), eq(parcelles.id, String(featureId))))
    .returning({ id: parcelles.id })
  if (updated.length) {
    await upsertCultures(tx, recordId, String(featureId), properties.cultures)
    await upsertAnnotations(tx, recordId, String(featureId), properties.annotations)
  }
}
async function deleteFeature(tx: NodePgDatabase, recordId: string, featureId: FeatureId): Promise<void> {
  await tx.delete(parcelles).where(and(eq(parcelles.recordId, recordId), eq(parcelles.id, String(featureId))))
}
async function insertFeature(tx: NodePgDatabase, recordId: string, id: FeatureId, feature: FeatureInput, from: FeatureId[] | null): Promise<void> {
  const properties = feature.properties ?? {}
  const geometry = geometryInput(feature.geometry)
  await tx.insert(parcelles).values({
    recordId,
    id: String(id),
    geometry,
    surfaceHa: sql`round((ST_Area(${geometry}::geography) / 10000)::numeric, 4)`,
    commune: blankToNull(properties.COMMUNE),
    conversionNiveau: sql`${properties.conversion_niveau || null}::cartobio.conversion_niveau`,
    engagementDate: sql`${properties.engagement_date || null}::date`,
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
    fromParcelles: from ? from.map(String) : null
  })
  await upsertCultures(tx, recordId, String(id), properties.cultures ?? [])
  await upsertAnnotations(tx, recordId, String(id), properties.annotations ?? [])
}
async function addFeature(tx: NodePgDatabase, recordId: string, id: FeatureId, feature: FeatureInput): Promise<void> {
  await insertFeature(tx, recordId, id, feature, null)
}
async function softDeleteFeatures(tx: NodePgDatabase, recordId: string, featureIds: FeatureId[]): Promise<void> {
  await tx
    .update(parcelles)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(parcelles.recordId, recordId), inArray(parcelles.id, featureIds.map(String))))
}
async function addFeaturesFromOther(
  tx: NodePgDatabase,
  recordId: string,
  features: FeatureInput[],
  from: FeatureId[]
): Promise<void> {
  for (const feature of features) {
    const id = Date.now() + Math.round(Math.random() * 1000)
    await insertFeature(tx, recordId, id, feature, from)
  }
}
async function refreshMixite(tx: NodePgDatabase, recordId: string): Promise<void> {
  const [{ mixite }] = await tx
    .select({ mixite: mixiteParcelles })
    .from(parcelles)
    .where(and(eq(parcelles.recordId, recordId), isNull(parcelles.deletedAt)))
  await tx
    .update(parcellaires)
    .set({ mixite: sql`${mixite}::cartobio.mixite_type` })
    .where(eq(parcellaires.recordId, recordId))
}

export {
  deleteRecord,
  markFeatureControlled,
  markFeatureUncontrolled,
  findMixite,
  updateAuditRecord,
  setOperatorUpdatedAt,
  patchFeature,
  updateFeature,
  deleteFeature,
  addFeature,
  softDeleteFeatures,
  addFeaturesFromOther,
  refreshMixite
}
