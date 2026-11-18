import { cartobio } from "./cartobio.js";

export const certificationType = cartobio.enum('certification_type', [
  'OPERATOR_DRAFT',
  'AUDITED',
  'PENDING_CERTIFICATION',
  'CERTIFIED',
]);

export const mixiteType = cartobio.enum('mixite_type', ['MIXTE', 'AB', 'ABCONV']);

export const conversionNiveau = cartobio.enum('conversion_niveau', [
  'AB',
  'AB?',
  'C1',
  'C2',
  'C3',
  'CONV',
]);

export const annotationType = cartobio.enum('annotation_type', [
  'DOWNGRADED',
  'METADATA_STATE',
  'REDUCED_CONVERSION_PERIOD',
  'RISKY',
  'SAMPLED',
  'SURVEYED',
]);

export const parcellaireEventType = cartobio.enum('parcellaire_event_type', [
  'CERTIFICATION_STATE_CHANGE',
  'FEATURE_COLLECTION_CREATE',
  'FEATURE_COLLECTION_DELETE',
  'FEATURE_COLLECTION_UPDATE',
  'FEATURE_CREATE',
  'FEATURE_DELETE',
  'FEATURE_UPDATE',
]);

export const statutImportGeom = cartobio.enum('statut_import_geom', [
  'ACCEPTE',
  'CORRIGE',
  'ACCEPTE_NON_CORRIGE',
]);

export const importStatus = cartobio.enum('import_status', ['DONE', 'CREATED', 'ERROR', 'PENDING']);

export const importLogType = cartobio.enum('import_log_type', ['warning', 'error']);

export const importJobResult = cartobio.enum('import_job_result', ['REJECTED', 'VALID', 'ERROR']);

export const importJobEtat = cartobio.enum('import_job_etat', ['UNKNOWN', 'UPDATED', 'CREATED']);

export const productionAttestationType = cartobio.enum('production_attestation_type', [
  'complete',
  'pac-details',
  'pac-complet',
]);

export const productionAttestationStatus = cartobio.enum('production_attestation_status', [
  'generated',
  'error',
]);