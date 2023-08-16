/**
 * @typedef {Object} HistoryEntry
 * @property {EventType} type
 * @property {String=} state
 * @property {String} date
 * @property {Object=} metadata
 * @property {String=} description
 * @property {HistoryEntryUser} user
 * @property {Array<number>=} featureIds
 */

/**
 * @typedef {Object} HistoryEntryUser
 * @property {number} id
 * @property {String} nom
 * @property {{id: number, nom: string }} organismeCertificateur
 * @property {{id: number, nom: string }} mainGroup
 */

/**
 * @enum {String}
 */
const EventType = {
  CERTIFICATION_STATE_CHANGE: 'CertificationStateChange',
  FEATURE_COLLECTION_CREATE: 'FeatureCollectionCreation',
  FEATURE_COLLECTION_DELETE: 'FeatureCollectionDeletion',
  FEATURE_COLLECTION_UPDATE: 'FeatureCollectionUpdate',
  FEATURE_CREATE: 'FeatureCreation',
  FEATURE_DELETE: 'FeatureDeletion',
  FEATURE_UPDATE: 'FeatureUpdate'
}

const EventTypeRules = {

}

function createNewEvent (eventType, payload, { description, state, ...event }, { decodedToken }) {
  return {
    ...event,
    type: eventType,
    ...(description ? { description } : {}),
    ...(state ? { state } : {}),
    date: new Date().toISOString(),
    featureIds: collectFeatureIdsFromPayload(payload),
    user: {
      id: decodedToken.id,
      nom: `${decodedToken.prenom ?? ''} ${decodedToken.nom ?? ''}`.trim(),
      organismeCertificateur: decodedToken.organismeCertificateur,
      mainGroup: decodedToken.mainGroup
    }
  }
}

function collectFeatureIdsFromPayload (payload) {
  if (payload && Object.hasOwn(payload, 'features') && Array.isArray(payload?.features)) {
    return payload.features.map(({ id }) => id)
  } else {
    return null
  }
}

module.exports = {
  collectFeatureIdsFromPayload,
  createNewEvent,
  EventType
}
