const { featureCollection } = require('@turf/helpers')
const { normalizeParcelle } = require('./features')
const { EtatProduction } = require('../enums')

/**
 * @typedef {import('../providers/types/agence-bio').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/types/cartobio').DBOperatorRecord} DBOperatorRecord
 * @typedef {import('../providers/types/cartobio').DBOperatorRecordWithParcelles} DBOperatorRecordWithParcelles
 * @typedef {import('./types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/record').NormalizedRecordSummary} NormalizedRecordSummary
 */

/**
 * Normalize a record
 * @param {DBOperatorRecordWithParcelles} record
 * @returns {NormalizedRecord}
 */
function normalizeRecord (record) {
  const features = (record?.parcelles ?? [])
    .map(normalizeParcelle)

  return {
    ...record,
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
    ...record
  }
}

/**
 * @param {String} etat
 * @param {object} options
 * @param {boolean} options.strict
 * @returns {EtatProduction|String}
 */
function normalizeEtatProduction (etat, options = { strict: false }) {
  if (Object.hasOwn(EtatProduction, etat)) {
    return EtatProduction[etat]
  }

  if (options.strict) {
    throw new Error(`EtatProduction invalide: ${etat}`)
  }

  return etat
}

module.exports = {
  normalizeRecord,
  normalizeRecordSummary,
  normalizeEtatProduction
}
