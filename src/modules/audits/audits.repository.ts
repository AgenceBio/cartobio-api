import { SQL, and, eq, inArray, sql } from 'drizzle-orm'
import type { FeatureInput, FeaturePropertiesInput, HistoryEntry } from '@agencebio/cartobio-types'
import type { DBOperatorRecord } from '../../shared/parcellaires/parcellaires.types.js'
import { db } from '../../database/database.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { parcellaires, parcelles, parcellesControles } from '../../database/schema/index.js'
import {
  ensureOrganismeCertificateur,
  findMixite,
  findRecord,
  insertEvent,
  updateMixite,
  upsertAnnotations,
  upsertCultures
} from '../../shared/parcellaires/parcellaires.repository.js'
import { blankToNull, parcelleInsertValues } from '../../shared/parcellaires/parcellaires.utils.js'
import {
  assertUnmodified,
  featureUpdateSet,
  geometryInput,
  recordColumnsByLegacyName,
  unmodifiedSinceCondition
} from './audits.utils.js'
import { createParcelleControleSchema } from '../../database/validations/activites.js'
import { updateParcellaireSchema } from '../../database/validations/parcellaires.js'
import type { AuditRecordChanges } from './audits.types.js'

type FeatureId = string | number

async function softDeleteRecord(recordId: string): Promise<void> {
  await db
    .update(parcellaires)
    .set({ deletedAt: sql`now()` })
    .where(eq(parcellaires.recordId, recordId))
}

async function insertParcelleControle(recordId: string, id: FeatureId, userId: number): Promise<void> {
  await db
    .insert(parcellesControles)
    .values(
      createParcelleControleSchema.parse({
        recordId,
        parcelleId: String(id),
        userId: String(userId)
      })
    )
    .onConflictDoNothing({
      target: [parcellesControles.recordId, parcellesControles.parcelleId, parcellesControles.userId]
    })
}

async function deleteParcelleControle(recordId: string, id: FeatureId, userId: number): Promise<void> {
  await db
    .delete(parcellesControles)
    .where(
      and(
        eq(parcellesControles.recordId, recordId),
        eq(parcellesControles.parcelleId, String(id)),
        eq(parcellesControles.userId, String(userId))
      )
    )
}

async function updateAuditRecord(
  tx: NodePgDatabase,
  recordId: string,
  changes: AuditRecordChanges,
  historyEntry: HistoryEntry | null,
  ifUnmodifiedSince?: string
): Promise<DBOperatorRecord[]> {
  const set: Record<string, SQL> = {}
  const values: Record<string, unknown> = {}
  for (const [field, value] of Object.entries<unknown>(changes)) {
    if (field === 'oc_label') continue
    const column = recordColumnsByLegacyName[field]
    if (!column) throw new Error(`column "${field}" of relation "parcellaires" does not exist`)
    const isBlank = value != null && blankToNull(value) === null
    if (isBlank && column === 'versionNom') continue
    if (value instanceof SQL) set[column] = value
    else values[column] = isBlank ? null : (value ?? null)
  }
  if (Object.keys(values).length > 0) {
    for (const [column, value] of Object.entries(updateParcellaireSchema.parse(values))) set[column] = sql`${value}`
  }

  if (changes.oc_id != null) {
    await ensureOrganismeCertificateur(tx, changes.oc_id, changes.oc_label)
  }
  assertUnmodified(
    await tx
      .update(parcellaires)
      .set(set)
      .where(and(eq(parcellaires.recordId, recordId), unmodifiedSinceCondition(ifUnmodifiedSince)))
      .returning({ recordId: parcellaires.recordId })
  )
  await insertEvent(tx, recordId, historyEntry)
  const record = await findRecord(tx, recordId)
  return record ? [record] : []
}

async function setOperatorUpdatedAt(
  tx: NodePgDatabase,
  recordId: string,
  historyEntry: HistoryEntry | null,
  ocId: number | null,
  ocLabel: string | null,
  ifUnmodifiedSince?: string
): Promise<DBOperatorRecord[]> {
  const [current] = await tx
    .select({ ocId: parcellaires.ocId })
    .from(parcellaires)
    .where(eq(parcellaires.recordId, recordId))
  if (current && current.ocId === null && ocId !== null) {
    await ensureOrganismeCertificateur(tx, ocId, ocLabel)
  }
  const updated = await tx
    .update(parcellaires)
    .set({
      updatedAt: sql`now()`,
      ocId: sql`coalesce(${parcellaires.ocId}, ${ocId})`
    })
    .where(and(eq(parcellaires.recordId, recordId), unmodifiedSinceCondition(ifUnmodifiedSince)))
    .returning({ recordId: parcellaires.recordId })
  if (current) assertUnmodified(updated)
  if (current) await insertEvent(tx, recordId, historyEntry)
  const record = await findRecord(tx, recordId)
  return record ? [record] : []
}

async function patchFeature(
  tx: NodePgDatabase,
  recordId: string,
  featureId: FeatureId,
  feature: FeatureInput
): Promise<void> {
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

async function updateFeatureById(
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

async function insertFeature(
  tx: NodePgDatabase,
  recordId: string,
  id: FeatureId,
  feature: FeatureInput,
  from: FeatureId[] | null
): Promise<void> {
  const properties = feature.properties ?? {}
  await tx
    .insert(parcelles)
    .values(
      parcelleInsertValues(
        recordId,
        String(id),
        properties,
        geometryInput(feature.geometry),
        sql`false`,
        from ? from.map(String) : null
      )
    )
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
  features: Array<FeatureInput & { id: FeatureId }>,
  from: FeatureId[]
): Promise<void> {
  for (const feature of features) {
    await insertFeature(tx, recordId, feature.id, feature, from)
  }
}

export {
  softDeleteRecord,
  insertParcelleControle,
  deleteParcelleControle,
  findMixite,
  updateAuditRecord,
  setOperatorUpdatedAt,
  patchFeature,
  updateFeatureById,
  deleteFeature,
  addFeature,
  softDeleteFeatures,
  addFeaturesFromOther,
  updateMixite
}
