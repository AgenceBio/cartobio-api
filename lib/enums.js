/*
 * Enum are placed in this separate file to avoid importing
 * the whole library in the types package.
 */

/**
 * @readonly
 * @enum {String}
 */
const CertificationState = {
  OPERATOR_DRAFT: 'OPERATOR_DRAFT', // Phase 2
  AUDITED: 'AUDITED', // Phase 3
  PENDING_CERTIFICATION: 'PENDING_CERTIFICATION', // Phase 4
  CERTIFIED: 'CERTIFIED' // Phase 5
}

/**
 * @readonly
 * @enum {String}
 */
const EtatProduction = {
  C0: 'CONV',
  CONV: 'CONV',
  NB: 'CONV',
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
  AB: 'AB'
}

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

module.exports = {
  CertificationState,
  EtatProduction,
  EventType
}
