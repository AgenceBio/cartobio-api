'use strict'

const cartobio = require('../../../src/shared/cartobio.service.js')
const { findValidAttestationProduction } = require('../exports/exports.service.js')
const { normalizeRecord } = require('../../../src/shared/outputs/record.js')
const repository = require('./audits.repository.js')
const { CertificationState, EventType } = require('../../../src/shared/enums.js')
const { createNewEvent } = require('../../../src/shared/outputs/history.js')
const { InvalidRequestApiError, ForbiddenApiError, NotFoundApiError } = require('../../../src/shared/errors.js')
const { getRandomFeatureId } = require('../../../src/shared/outputs/features.js')
const { fetchEmailForNumeroBio } = require('../../../src/clients/agence-bio.client.js')
const { sendCertificationComplete } = require('../../services/mailer/utils.js')

async function deleteRecord ({ record }) { await repository.deleteRecord(record.record_id) }
async function markFeatureControlled (recordId, id, userId) { await repository.markFeatureControlled(recordId, id, userId) }
async function markFeatureUncontrolled (recordId, id, userId) { await repository.markFeatureUncontrolled(recordId, id, userId) }

function getOc (user, operator) {
  return {
    id: user.organismeCertificateur?.id || operator.organismeCertificateur?.id || null,
    label: user.organismeCertificateur?.nom || operator.organismeCertificateur?.nom || null
  }
}

async function updateAuditRecordState ({ user, record, operator }, patch) {
  if (record.oc_id !== null && user.organismeCertificateur && record.oc_id !== user.organismeCertificateur.id) throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier de ce parcellaire.")

  const { certification_state: state } = patch
  const columns = ['updated_at']
  const placeholders = ['$2']
  const values = ['NOW()']
  for (const [field, value] of Object.entries(patch)) {
    columns.push(field)
    placeholders.push(`$${columns.length + 1}`)
    values.push(value)
  }

  if (record.oc_id === null) {
    const oc = getOc(user, operator)
    if (oc.id) {
      columns.push('oc_id', 'oc_label')
      placeholders.push(`$${columns.length}`, `$${columns.length + 1}`)
      values.push(oc.id, oc.label)
    }
  }
  if (state) {
    columns.push('audit_history')
    placeholders.push(`audit_history || $${columns.length + 1}::jsonb`)
    values.push(createNewEvent(EventType.CERTIFICATION_STATE_CHANGE, { state }, { user, record }))
    if (state === CertificationState.AUDITED && !columns.includes('audit_date')) {
      columns.push('audit_date')
      placeholders.push(`$${columns.length + 1}`)
      values.push('NOW()')
    }
    if (state === CertificationState.CERTIFIED && !columns.includes('mixite')) {
      columns.push('mixite')
      placeholders.push(`$${columns.length + 1}`)
      values.push(await repository.findMixite(record.record_id))
    }
  }

  let rows
  try {
    rows = await repository.updateAuditRecord(record.record_id, columns, placeholders, values)
    if (user && String(user.mainGroup.id) === '4') rows[0].audit_notes = null
    if (state === CertificationState.CERTIFIED && record.certification_state !== CertificationState.CERTIFIED) {
      try {
        const emails = await fetchEmailForNumeroBio(record.numerobio)
        for (const utilisateur of emails.utilisateurs) {
          const info = await sendCertificationComplete(record, utilisateur.email)
          console.log(`[EMAIL] Mail de certification envoyé à ${utilisateur.email} ${info}`)
        }
        await repository.markCertificationNotified(record.record_id)
      } catch { console.error(`Erreur lors de l'envoi de la notification de certification pour le record ${record.record_id}`) }
    }
  } catch (error) {
    if (error.code === '23505') throw new InvalidRequestApiError("Un parcellaire ne peut pas avoir deux versions avec la même date d'audit.", { cause: error })
    throw error
  }
  return cartobio.joinRecordParcelles(rows.at(0))
}

async function updateOperator (client, record, historyEntry, user, operator) {
  const oc = getOc(user, operator)
  return repository.setOperatorUpdatedAt(client, record.record_id, historyEntry, oc.id, oc.label)
}
async function refreshMixiteIfCertified (client, record) { if (record.certification_state === CertificationState.CERTIFIED) await repository.refreshMixite(client, record.record_id) }

async function patchFeatureCollection ({ user, record, operator }, features) {
  const historyEntry = createNewEvent(EventType.FEATURE_COLLECTION_UPDATE, { features }, { user, record })
  const updatedRecord = await repository.withTransaction(async client => {
    const { rows } = await updateOperator(client, record, historyEntry, user, operator)
    for (const feature of features) {
      await repository.patchFeature(client, record.record_id, feature.id || getRandomFeatureId(), feature)
      await refreshMixiteIfCertified(client, record)
    }
    return rows.at(0)
  })
  return cartobio.joinRecordParcelles(updatedRecord)
}

async function updateFeature ({ featureId, user, record, operator }, { properties, geometry }) {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === String(featureId))
  if (!matchingFeature) throw new NotFoundApiError('Parcelle introuvable')
  const historyEntry = createNewEvent(EventType.FEATURE_UPDATE, { features: [matchingFeature] }, { user, record })
  const updatedRecord = await repository.withTransaction(async client => {
    const { rows } = await updateOperator(client, record, historyEntry, user, operator)
    await repository.updateFeature(client, record.record_id, featureId, properties, geometry)
    await refreshMixiteIfCertified(client, record)
    return rows.at(0)
  })
  return cartobio.joinRecordParcelles(updatedRecord)
}

async function deleteSingleFeature ({ featureId, user, record, operator }, { reason }) {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === String(featureId))
  if (!matchingFeature) throw new NotFoundApiError('Parcelle introuvable')
  const historyEntry = createNewEvent(EventType.FEATURE_DELETE, { features: [matchingFeature], metadata: { reason, feature: matchingFeature } }, { user, record })
  const updatedRecord = await repository.withTransaction(async client => {
    await repository.deleteFeature(client, record.record_id, featureId)
    const { rows } = await updateOperator(client, record, historyEntry, user, operator)
    return rows.at(0)
  })
  return cartobio.joinRecordParcelles(updatedRecord)
}

async function addRecordFeature ({ user, record, operator }, feature) {
  const historyEntry = createNewEvent(EventType.FEATURE_CREATE, { features: [feature], description: `Parcelle ${feature.properties.cadastre} ajoutée` }, { user, record })
  const updatedRecord = await repository.withTransaction(async client => {
    await repository.addFeature(client, record.record_id, Date.now(), feature)
    const { rows } = await updateOperator(client, record, historyEntry, user, operator)
    await refreshMixiteIfCertified(client, record)
    return rows.at(0)
  })
  return cartobio.joinRecordParcelles(updatedRecord)
}

async function createFeaturesFromOther (user, record, operator, features, from) {
  const historyEntry = createNewEvent(EventType.FEATURE_CREATE, { features, description: 'Parcelles ajoutées' }, { user, record })
  const updatedRecord = await repository.withTransaction(async client => {
    await repository.softDeleteFeatures(client, record.record_id, from)
    await repository.addFeaturesFromOther(client, record.record_id, features, from)
    const { rows } = await updateOperator(client, record, historyEntry, user, operator)
    await refreshMixiteIfCertified(client, record)
    return rows.at(0)
  })
  return cartobio.joinRecordParcelles(updatedRecord)
}

module.exports = { getAttestationProduction: findValidAttestationProduction, normalizeRecord, markFeatureControlled, markFeatureUncontrolled, createOrUpdateOperatorRecord: cartobio.createOrUpdateOperatorRecord, deleteRecord, updateAuditRecordState, addRecordFeature, patchFeatureCollection, updateFeature, deleteSingleFeature, createFeaturesFromOther }
