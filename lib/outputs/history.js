const { CertificationState, EventType } = require('../enums')

/**
 * @typedef {import('../providers/types/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('../providers/types/cartobio').DBOperatorRecord} DBOperatorRecord
 * @typedef {import('./types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/history').HistoryEntry} HistoryEntry
 */

function isAfterCertificationState (referenceState) {
  const stateValues = Object.values(CertificationState)
  const lookupIndex = stateValues.indexOf(referenceState)

  return function isCandidate (lookup) {
    return stateValues.indexOf(lookup) >= lookupIndex
  }
}

const hasBeenAudited = isAfterCertificationState(CertificationState.AUDITED)

/**
 * @type {Array<(event: {eventType: EventType, record: NormalizedRecord}) => boolean>}
 */
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

/**
 * Determine if a new HistoryEntry should be created
 * @param {Object} params
 * @param {NormalizedRecord} params.record - the previous state of operator record
 * @param {EventType} params.eventType - the type of event
 * @returns {boolean} - true if a new HistoryEntry should be created
 */
function shouldCreateHistoryEvent ({ record, eventType }) {
  return EventTypeRules.some(rule => rule({ record, eventType }))
}

/**
 * Create a new Event it necessary
 * @param {EventType} eventType
 * @param {Object} payload
 * @param {String} [payload.description]
 * @param {String} [payload.state]
 * @param {Object} [payload.metadata]
 * @param {Partial<CartoBioFeature>[]} [payload.features]
 * @param {Date} [payload.date]
 * @param {Object} context
 * @param {CartoBioUser} context.user
 * @param {NormalizedRecord|null} context.record
 * @returns {HistoryEntry|null}
 */
function createNewEvent (eventType, payload, { user, record }) {
  const { features, date, ...event } = payload
  if (!record || !user || shouldCreateHistoryEvent({ record, eventType })) {
    return {
      type: eventType,
      ...event,
      ...(features ? { featureIds: collectFeatureIdsFromPayload(features) } : {}),
      date: (date || new Date()).toISOString(),
      ...(user ? { user } : {})
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
  EventType,
  collectFeatureIdsFromPayload,
  createNewEvent
}
