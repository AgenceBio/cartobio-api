/*
 * Enum are placed in this separate file to avoid importing
 * the whole library in the types package.
 */

const CertificationState = {
  OPERATOR_DRAFT: 'OPERATOR_DRAFT', // Phase 2
  AUDITED: 'AUDITED', // Phase 3
  PENDING_CERTIFICATION: 'PENDING_CERTIFICATION', // Phase 4
  CERTIFIED: 'CERTIFIED' // Phase 5
} as const

const EtatProduction = {
  C0: 'CONV',
  CONV: 'CONV',
  NB: 'CONV',
  BIO: 'AB?', // Niveau de conversion bio à préciser
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
  AB: 'AB'
} as const

const EventType = {
  CERTIFICATION_STATE_CHANGE: 'CertificationStateChange',
  FEATURE_COLLECTION_CREATE: 'FeatureCollectionCreation',
  FEATURE_COLLECTION_DELETE: 'FeatureCollectionDeletion',
  FEATURE_COLLECTION_UPDATE: 'FeatureCollectionUpdate',
  FEATURE_CREATE: 'FeatureCreation',
  FEATURE_DELETE: 'FeatureDeletion',
  FEATURE_UPDATE: 'FeatureUpdate'
} as const

const Area = {
  METROPOLE: 'metropole',
  ANTILLES: 'antilles',
  GUYANE: 'guyane',
  REUNION: 'reunion',
  MAYOTTE: 'mayotte'
} as const

const LegalProjections = {
  // https://epsg.io/2154
  [Area.METROPOLE]: '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  // https://epsg.io/5490
  [Area.ANTILLES]: '+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/2975
  [Area.REUNION]: '+proj=utm +zone=40 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/2972
  [Area.GUYANE]: '+proj=utm +zone=22 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/4471
  [Area.MAYOTTE]: '+proj=utm +zone=38 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'
} as const

const RegionBounds = {
  [Area.METROPOLE]: [-5.1412, 41.334, 9.5597, 51.0888],
  [Area.ANTILLES]: [-61.8098, 14.3947, -60.8106, 16.511],
  [Area.GUYANE]: [-54.6023, 2.1111, -51.619, 5.7487],
  [Area.REUNION]: [55.2166, -21.3891, 55.8366, -20.8721],
  [Area.MAYOTTE]: [45.0185, -13.0001, 45.298, -12.6366]
} as const

const AttestationsProductionsStatus = {
  STARTED: 'started',
  ERROR: 'error',
  GENERATED: 'generated'
} as const

const AttestationsProductionsType = {
  PACDETAILS: 'pac-details',
  PACCOMPLET: 'pac-complet',
  COMPLET: 'complete'
} as const

export {
  CertificationState,
  EtatProduction,
  EventType,
  LegalProjections,
  RegionBounds,
  AttestationsProductionsStatus,
  AttestationsProductionsType
}

export type CertificationState = (typeof CertificationState)[keyof typeof CertificationState]
export type EtatProduction = (typeof EtatProduction)[keyof typeof EtatProduction]
export type EventType = (typeof EventType)[keyof typeof EventType]
export type LegalProjections = (typeof LegalProjections)[keyof typeof LegalProjections]
export type RegionBounds = (typeof RegionBounds)[keyof typeof RegionBounds]
export type AttestationsProductionsStatus = (typeof AttestationsProductionsStatus)[keyof typeof AttestationsProductionsStatus]
export type AttestationsProductionsType = (typeof AttestationsProductionsType)[keyof typeof AttestationsProductionsType]
