import * as cartobio from '../../shared/parcellaires/parcellaires.service.js'
import { findValidAttestationProduction } from '../exports/exports.service.js'
import { normalizeRecord } from '../../shared/outputs/record.js'
import * as repository from './audits.repository.js'
import { db, firstRow } from '../../database/database.js'
import { CertificationState, EventType } from '@agencebio/cartobio-types'
import type { AgenceBioNormalizedOperator, CartoBioUser, OrganismeCertificateur, DeleteFeatureBody, FeatureInput, HistoryEntry, NormalizedRecord, RecordInfosBody } from '@agencebio/cartobio-types'
import type { DBOperatorRecord, DBOperatorRecordWithParcelles } from '../../shared/parcellaires/parcellaires.types.js'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { createNewEvent } from '../../shared/outputs/history.js'
import { InvalidRequestApiError, ForbiddenApiError, NotFoundApiError, getErrorCode } from '../../shared/errors.js'
import { getRandomFeatureId } from '../../shared/outputs/features.js'
import { assertConversionNiveau } from './audits.utils.js'
import type { AuditRecordChanges } from './audits.types.js'

type FeatureId = string | number
type OptionalOperator = AgenceBioNormalizedOperator | null | undefined

type AuditUser = CartoBioUser & { organismeCertificateur?: OrganismeCertificateur }
type AuditContext = { user: AuditUser | null; record: NormalizedRecord; operator?: OptionalOperator }

async function deleteRecord ({ record }: { record: NormalizedRecord; user?: CartoBioUser }): Promise<void> { await repository.deleteRecord(record.record_id) }
async function markFeatureControlled (recordId: string, id: FeatureId, userId: number): Promise<void> { await repository.markFeatureControlled(recordId, id, userId) }
async function markFeatureUncontrolled (recordId: string, id: FeatureId, userId: number): Promise<void> { await repository.markFeatureUncontrolled(recordId, id, userId) }

function getOc (user: AuditUser | null, operator: OptionalOperator): { id: number | null; label: string | null } {
  return {
    id: user?.organismeCertificateur?.id || operator?.organismeCertificateur?.id || null,
    label: user?.organismeCertificateur?.nom || operator?.organismeCertificateur?.nom || null
  }
}

async function updateAuditRecordState ({ user, record, operator }: { user: AuditUser; record: NormalizedRecord; operator?: OptionalOperator }, patch: RecordInfosBody & { certification_state?: CertificationState }): Promise<DBOperatorRecordWithParcelles> {
  if (record.oc_id !== null && user.organismeCertificateur && record.oc_id !== user.organismeCertificateur.id) throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier de ce parcellaire.")

  const { certification_state: state } = patch
  const changes: AuditRecordChanges = { updated_at: sql`now()`, ...patch }

  if (record.oc_id === null) {
    const oc = getOc(user, operator)
    if (oc.id) {
      changes.oc_id = oc.id
      changes.oc_label = oc.label
    }
  }
  let historyEntry: HistoryEntry | null = null
  if (state) {
    historyEntry = createNewEvent(EventType.CERTIFICATION_STATE_CHANGE, { state }, { user, record })
    if (state === CertificationState.AUDITED && !('audit_date' in changes)) {
      changes.audit_date = sql`now()`
    }
    if (state === CertificationState.CERTIFIED && !('mixite' in changes)) {
      changes.mixite = await repository.findMixite(record.record_id)
    }
  }

  let rows
  try {
    rows = await repository.updateAuditRecord(record.record_id, changes, historyEntry)
    if (user && String(user.mainGroup.id) === '4') firstRow(rows).audit_notes = null
    if (state === CertificationState.CERTIFIED && record.certification_state !== CertificationState.CERTIFIED) {
      await cartobio.notifyCertificationComplete(record)
    }
  } catch (error) {
    if (getErrorCode(error) === '23505') throw new InvalidRequestApiError("Un parcellaire ne peut pas avoir deux versions avec la même date d'audit.", { cause: error })
    throw error
  }
  return joinRecordParcelles(firstRow(rows))
}

async function joinRecordParcelles (record: DBOperatorRecord): Promise<DBOperatorRecordWithParcelles> {
  return cartobio.withHistoryUsers(await cartobio.joinRecordParcelles(record))
}

async function updateOperator (tx: NodePgDatabase, record: NormalizedRecord, historyEntry: HistoryEntry | null, user: AuditUser | null, operator: OptionalOperator): Promise<DBOperatorRecord[]> {
  const oc = getOc(user, operator)
  return repository.setOperatorUpdatedAt(tx, record.record_id, historyEntry, oc.id, oc.label)
}
async function refreshMixiteIfCertified (tx: NodePgDatabase, record: NormalizedRecord): Promise<void> { if (record.certification_state === CertificationState.CERTIFIED) await repository.updateMixite(tx, record.record_id) }

async function patchFeatureCollection ({ user, record, operator }: AuditContext, input: FeatureInput[]): Promise<DBOperatorRecordWithParcelles> {
  assertConversionNiveau(record.certification_state, input, false)
  const features = input.map((feature) => ({ ...feature, id: feature.id || getRandomFeatureId() }))
  const historyEntry = createNewEvent(EventType.FEATURE_COLLECTION_UPDATE, { features }, { user, record })
  const updatedRecord = await db.transaction(async tx => {
    const rows = await updateOperator(tx, record, historyEntry, user, operator)
    for (const feature of features) {
      await repository.patchFeature(tx, record.record_id, feature.id, feature)
    }
    await refreshMixiteIfCertified(tx, record)
    return firstRow(rows)
  })
  return joinRecordParcelles(updatedRecord)
}

async function updateFeature ({ featureId, user, record, operator }: AuditContext & { featureId: FeatureId }, { properties, geometry }: FeatureInput): Promise<DBOperatorRecordWithParcelles> {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === String(featureId))
  if (!matchingFeature) throw new NotFoundApiError('Parcelle introuvable')
  assertConversionNiveau(record.certification_state, [{ properties, geometry }], false)
  const historyEntry = createNewEvent(EventType.FEATURE_UPDATE, { features: [matchingFeature] }, { user, record })
  const updatedRecord = await db.transaction(async tx => {
    const rows = await updateOperator(tx, record, historyEntry, user, operator)
    await repository.updateFeature(tx, record.record_id, String(featureId), properties ?? {}, geometry)
    await refreshMixiteIfCertified(tx, record)
    return firstRow(rows)
  })
  return joinRecordParcelles(updatedRecord)
}

async function deleteSingleFeature ({ featureId, user, record, operator }: { featureId: FeatureId; user: AuditUser; record: NormalizedRecord; operator?: OptionalOperator }, { reason }: DeleteFeatureBody): Promise<DBOperatorRecordWithParcelles> {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === String(featureId))
  if (!matchingFeature) throw new NotFoundApiError('Parcelle introuvable')
  const historyEntry = createNewEvent(EventType.FEATURE_DELETE, { features: [matchingFeature], metadata: { reason, feature: matchingFeature } }, { user, record })
  const updatedRecord = await db.transaction(async tx => {
    await repository.deleteFeature(tx, record.record_id, String(featureId))
    const rows = await updateOperator(tx, record, historyEntry, user, operator)
    return firstRow(rows)
  })
  return joinRecordParcelles(updatedRecord)
}

async function addRecordFeature ({ user, record, operator }: AuditContext, feature: FeatureInput): Promise<DBOperatorRecordWithParcelles> {
  assertConversionNiveau(record.certification_state, [feature], true)
  const id = getRandomFeatureId()
  const historyEntry = createNewEvent(EventType.FEATURE_CREATE, { features: [{ ...feature, id }], description: `Parcelle ${feature.properties?.cadastre} ajoutée` }, { user, record })
  const updatedRecord = await db.transaction(async tx => {
    await repository.addFeature(tx, record.record_id, id, feature)
    const rows = await updateOperator(tx, record, historyEntry, user, operator)
    await refreshMixiteIfCertified(tx, record)
    return firstRow(rows)
  })
  return joinRecordParcelles(updatedRecord)
}

async function createFeaturesFromOther (user: AuditUser | null, record: NormalizedRecord, operator: OptionalOperator, input: FeatureInput[], from: FeatureId[]): Promise<DBOperatorRecordWithParcelles> {
  assertConversionNiveau(record.certification_state, input, true)
  const features = input.map((feature) => ({ ...feature, id: getRandomFeatureId() }))
  const historyEntry = createNewEvent(EventType.FEATURE_CREATE, { features, description: 'Parcelles ajoutées' }, { user, record })
  const updatedRecord = await db.transaction(async tx => {
    await repository.softDeleteFeatures(tx, record.record_id, from)
    await repository.addFeaturesFromOther(tx, record.record_id, features, from)
    const rows = await updateOperator(tx, record, historyEntry, user, operator)
    await refreshMixiteIfCertified(tx, record)
    return firstRow(rows)
  })
  return joinRecordParcelles(updatedRecord)
}

export { createOrUpdateOperatorRecord } from '../../shared/parcellaires/parcellaires.service.js'
export {
  findValidAttestationProduction as getAttestationProduction,
  normalizeRecord,
  markFeatureControlled,
  markFeatureUncontrolled,
  deleteRecord,
  updateAuditRecordState,
  addRecordFeature,
  patchFeatureCollection,
  updateFeature,
  deleteSingleFeature,
  createFeaturesFromOther
}
