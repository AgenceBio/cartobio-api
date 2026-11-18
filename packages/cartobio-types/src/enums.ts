/*
 * Enum are placed in this separate file to avoid importing
 * the whole library in the types package.
 */

export const CertificationState = {
  OPERATOR_DRAFT: 'OPERATOR_DRAFT', // Phase 2
  AUDITED: 'AUDITED', // Phase 3
  PENDING_CERTIFICATION: 'PENDING_CERTIFICATION', // Phase 4
  CERTIFIED: 'CERTIFIED' // Phase 5
} as const

export const EtatProduction = {
  C0: 'CONV',
  CONV: 'CONV',
  NB: 'CONV',
  BIO: 'AB?', // Niveau de conversion bio à préciser
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
  AB: 'AB'
} as const

export const EventType = {
  CERTIFICATION_STATE_CHANGE: 'CertificationStateChange',
  FEATURE_COLLECTION_CREATE: 'FeatureCollectionCreation',
  FEATURE_COLLECTION_DELETE: 'FeatureCollectionDeletion',
  FEATURE_COLLECTION_UPDATE: 'FeatureCollectionUpdate',
  FEATURE_CREATE: 'FeatureCreation',
  FEATURE_DELETE: 'FeatureDeletion',
  FEATURE_UPDATE: 'FeatureUpdate'
} as const

export const MetadataSource = {
  TELEPAC: 'TELEPAC',
  API_PARCELLAIRE: 'API_PARCELLAIRE',
  ANYGEO: 'ANYGEO',
  GEOFOLIA: 'GEOFOLIA',
  MES_PARCELLES: 'MES_PARCELLES',
  CVI: 'CVI',
  RPG: 'RPG',
  MANUEL: 'MANUEL',
  COPIE_VERSION: 'COPIE_VERSION',
  COPIE_CONFLIT: 'COPIE_CONFLIT'
} as const

export const ImportLogCode = {
  INVALID_FORMAT: 'INVALID_FORMAT',
  UNKNOWN_NUMERO_BIO: 'UNKNOWN_NUMERO_BIO',
  NOT_PRODUCTION: 'NOT_PRODUCTION',
  NO_OC: 'NO_OC',
  OC_MISMATCH: 'OC_MISMATCH',
  INVALID_DATE_CERTIFICATION_DEBUT: 'INVALID_DATE_CERTIFICATION_DEBUT',
  INVALID_DATE_CERTIFICATION_FIN: 'INVALID_DATE_CERTIFICATION_FIN',
  MISSING_CERTIFICATION_DATES: 'MISSING_CERTIFICATION_DATES',
  INVALID_DATE_AUDIT: 'INVALID_DATE_AUDIT',
  INVALID_ETAT_PRODUCTION: 'INVALID_ETAT_PRODUCTION',
  MISSING_DATE_ENGAGEMENT: 'MISSING_DATE_ENGAGEMENT',
  INVALID_DATE_ENGAGEMENT: 'INVALID_DATE_ENGAGEMENT',
  MISSING_CULTURES: 'MISSING_CULTURES',
  INVALID_CPF: 'INVALID_CPF',
  INVALID_GEOM: 'INVALID_GEOM',
  MISSING_GEOM: 'MISSING_GEOM',
  DB_ERROR: 'DB_ERROR',
  GEOM_OUT_OF_BOUNDS: 'GEOM_OUT_OF_BOUNDS',
  GEOM_CORRECTED: 'GEOM_CORRECTED',
  GEOM_INVALID_NOT_CORRECTED: 'GEOM_INVALID_NOT_CORRECTED',
  PAC_PENDING_WITH_ILOT: 'PAC_PENDING_WITH_ILOT'
} as const

export const ImportJobResult = {
  VALID: 'VALID',
  REJECTED: 'REJECTED',
  ERROR: 'ERROR'
} as const

export const ImportJobEtat = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  UNKNOWN: 'UNKNOWN'
} as const

const Area = {
  METROPOLE: 'metropole',
  ANTILLES: 'antilles',
  GUYANE: 'guyane',
  REUNION: 'reunion',
  MAYOTTE: 'mayotte'
} as const

export const LegalProjections = {
  // https://epsg.io/2154
  [Area.METROPOLE]:
    '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  // https://epsg.io/5490
  [Area.ANTILLES]: '+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/2975
  [Area.REUNION]: '+proj=utm +zone=40 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/2972
  [Area.GUYANE]: '+proj=utm +zone=22 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/4471
  [Area.MAYOTTE]: '+proj=utm +zone=38 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'
} as const

export const RegionBounds = {
  [Area.METROPOLE]: [-5.1412, 41.334, 9.5597, 51.0888],
  [Area.ANTILLES]: [-61.8098, 14.3947, -60.8106, 16.511],
  [Area.GUYANE]: [-54.6023, 2.1111, -51.619, 5.7487],
  [Area.REUNION]: [55.2166, -21.3891, 55.8366, -20.8721],
  [Area.MAYOTTE]: [45.0185, -13.0001, 45.298, -12.6366]
} as const

export const AttestationsProductionsStatus = {
  STARTED: 'started',
  ERROR: 'error',
  GENERATED: 'generated'
} as const

export const AttestationsProductionsType = {
  PACDETAILS: 'pac-details',
  PACCOMPLET: 'pac-complet',
  COMPLET: 'complete'
} as const

export type CertificationState = (typeof CertificationState)[keyof typeof CertificationState]
export type EtatProduction = (typeof EtatProduction)[keyof typeof EtatProduction]
export type EventType = (typeof EventType)[keyof typeof EventType]
export type MetadataSource = (typeof MetadataSource)[keyof typeof MetadataSource]
export type ImportLogCode = (typeof ImportLogCode)[keyof typeof ImportLogCode]
export type ImportJobResult = (typeof ImportJobResult)[keyof typeof ImportJobResult]
export type ImportJobEtat = (typeof ImportJobEtat)[keyof typeof ImportJobEtat]
export type LegalProjections = (typeof LegalProjections)[keyof typeof LegalProjections]
export type RegionBounds = (typeof RegionBounds)[keyof typeof RegionBounds]
export type AttestationsProductionsStatus =
  (typeof AttestationsProductionsStatus)[keyof typeof AttestationsProductionsStatus]
export type AttestationsProductionsType = (typeof AttestationsProductionsType)[keyof typeof AttestationsProductionsType]
