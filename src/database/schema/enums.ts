import { pgEnum } from 'drizzle-orm/pg-core';

export const certificationType = pgEnum('certification_type', [
  'OPERATOR_DRAFT',
  'AUDITED',
  'PENDING_CERTIFICATION',
  'CERTIFIED',
]);

export const mixiteType = pgEnum('mixite_type', ['MIXTE', 'AB', 'ABCONV']);

export const conversionNiveau = pgEnum('conversion_niveau', [
  'AB',
  'AB?',
  'C1',
  'C2',
  'C3',
  'CONV',
]);

export const annotationType = pgEnum('annotation_type', [
  'DOWNGRADED',
  'METADATA_STATE',
  'REDUCED_CONVERSION_PERIOD',
  'RISKY',
  'SAMPLED',
  'SURVEYED',
]);

export const parcellaireEventType = pgEnum('parcellaire_event_type', [
  'CERTIFICATION_STATE_CHANGE',
  'FEATURE_COLLECTION_CREATE',
  'FEATURE_COLLECTION_DELETE',
  'FEATURE_COLLECTION_UPDATE',
  'FEATURE_CREATE',
  'FEATURE_DELETE',
  'FEATURE_UPDATE',
]);

export const statutImportGeom = pgEnum('statut_import_geom', [
  'ACCEPTE',
  'CORRIGE',
  'ACCEPTE_NON_CORRIGE',
]);

export const importStatus = pgEnum('import_status', ['DONE', 'CREATED', 'ERROR', 'PENDING']);

export const importLogType = pgEnum('import_log_type', ['warning', 'error']);

export const importJobResult = pgEnum('import_job_result', ['REJECTED', 'VALID', 'ERROR']);

export const importJobEtat = pgEnum('import_job_etat', ['UNKNOWN', 'UPDATED', 'CREATED']);

export const productionAttestationType = pgEnum('production_attestation_type', [
  'complete',
  'pac-details',
  'pac-complet',
]);

export const productionAttestationStatus = pgEnum('production_attestation_status', [
  'generated',
  'error',
]);