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

/**
 * @enum {string}
 */
const CertificationState = {
  OPERATOR_DRAFT: 'OPERATOR_DRAFT', // Phase 2
  AUDITED: 'AUDITED', // Phase 3
  PENDING_CERTIFICATION: 'PENDING_CERTIFICATION', // Phase 4
  CERTIFIED: 'CERTIFIED' // Phase 5
}

function isAfterCertificationState (referenceState) {
  const stateValues = Object.values(CertificationState)
  const lookupIndex = stateValues.indexOf(referenceState)

  return function isCandidate (lookup) {
    return stateValues.indexOf(lookup) >= lookupIndex
  }
}

const hasBeenAudited = isAfterCertificationState(CertificationState.AUDITED)

const EventTypeRules = [
  // [*] Import/création du parcellaire
  ({ eventType: type }) => type === EventType.FEATURE_COLLECTION_CREATE,
  // [*] Suppression du parcellaire
  ({ eventType: type }) => type === EventType.FEATURE_COLLECTION_DELETE,
  // [AUDITED] Ajout de parcelle
  ({ eventType: type, record }) => type === EventType.FEATURE_CREATE && hasBeenAudited(record.certification_state),
  // [AUDITED] Suppression de parcelle
  ({ eventType: type, record }) => type === EventType.FEATURE_DELETE && hasBeenAudited(record.certification_state),
  // [*] Terminer l’audit
  // [*] Envoi du parcellaire pour certification
  // [*] Certification du parcellaire
  ({ eventType: type }) => type === EventType.CERTIFICATION_STATE_CHANGE,
  // [AUDITED] Changement sur le parcellaire
  ({ eventType: type, record }) => type === EventType.FEATURE_UPDATE && hasBeenAudited(record.certification_state),
  ({ eventType: type, record }) => type === EventType.FEATURE_COLLECTION_UPDATE && hasBeenAudited(record.certification_state)
]

function shouldCreateHistoryEvent ({ record, eventType, decodedToken }) {
  return EventTypeRules.some(rule => rule({ record, eventType, decodedToken }))
}

/**
 * Create a new Event it necessary
 * @param {EventType} eventType
 * @param {Object} payload
 * @param {{ decodedToken: Object, record: OperatorRecord }} context
 * @returns {HistoryEntry|null}
 */
function createNewEvent (eventType, { description, features, state, ...event }, { decodedToken, record }) {
  if (shouldCreateHistoryEvent({ record, eventType, decodedToken, state })) {
    return {
      ...event,
      type: eventType,
      ...(description ? { description } : {}),
      ...(state ? { state } : {}),
      ...(features ? { featureIds: collectFeatureIdsFromPayload(features) } : {}),
      date: new Date().toISOString(),
      user: {
        id: decodedToken.id,
        nom: `${decodedToken.prenom ?? ''} ${decodedToken.nom ?? ''}`.trim(),
        organismeCertificateur: decodedToken.organismeCertificateur,
        mainGroup: decodedToken.mainGroup
      }
    }
  }

  return null
}

function collectFeatureIdsFromPayload (payload) {
  if (payload && (Array.isArray(payload) || Array.isArray(payload?.features))) {
    return (payload?.features ?? payload).map(({ id }) => id)
  } else {
    return null
  }
}

module.exports = {
  CertificationState,
  EventType,

  collectFeatureIdsFromPayload,
  createNewEvent
}
