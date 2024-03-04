const { featureCollection } = require('@turf/helpers')
const { normalizeParcelle } = require('./features')

/**
 * @typedef {import('../providers/types/agence-bio').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/types/cartobio').DBOperatorRecord} DBOperatorRecord
 * @typedef {import('../providers/types/cartobio').DBOperatorRecordWithParcelles} DBOperatorRecordWithParcelles
 * @typedef {import('./types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/record').NormalizedRecordSummary} NormalizedRecordSummary
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
 * Normalize a record and add operator data
 * @param {DBOperatorRecordWithParcelles} record
 * @returns {NormalizedRecord}
 */
function normalizeRecord (record) {
  const features = (record?.parcelles ?? [])
    .map(normalizeParcelle)

  return {
    ...record,
    audit_date: record.audit_date?.toISOString().split('T')[0] ?? null,
    certification_date_debut: record.certification_date_debut?.toISOString().split('T')[0] ?? null,
    certification_date_fin: record.certification_date_fin?.toISOString().split('T')[0] ?? null,
    metadata: record?.metadata ?? {},
    parcelles: featureCollection(features)
  }
}

/**
 * @param {Omit<DBOperatorRecord, 'parcelles'> & { surface: number, parcelles: number }} record
 * @return {NormalizedRecordSummary}
 */
function normalizeRecordSummary (record) {
  return {
    ...record,
    audit_date: record.audit_date?.toISOString().split('T')[0] ?? null,
    certification_date_debut: record.certification_date_debut?.toISOString().split('T')[0] ?? null,
    certification_date_fin: record.certification_date_fin?.toISOString().split('T')[0] ?? null
  }
}

/**
 * @param {String} etat
 * @returns {EtatProduction|String}
 */
function normalizeEtatProduction (etat) {
  if (Object.hasOwn(EtatProduction, etat)) {
    return EtatProduction[etat]
  }

  return etat
}

module.exports = {
  normalizeRecord,
  normalizeRecordSummary,
  normalizeEtatProduction,
  EtatProduction,
  CertificationState
}
