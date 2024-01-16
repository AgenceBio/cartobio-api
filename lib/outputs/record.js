const { featureCollection } = require('@turf/helpers')
const { populateWithCommunesLabels, populateWithMultipleCultures } = require('./features.js')

/**
 * @typedef {import('../providers/types/agence-bio').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/types/cartobio').DBOperatorRecord} DBOperatorRecord
 * @typedef {import('./types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 */

/**
 * A database record normalized to be used in Cartobio, with operator data from Agence Bio
 * @typedef {DBOperatorRecord} NormalizedRecord
 * @property {AgenceBioNormalizedOperator=} operator
 */

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
 * @param {Object} data
 * @param {DBOperatorRecord} data.record
 * @param {AgenceBioNormalizedOperator} data.operator
 * @returns {NormalizedRecord}
 */
function normalizeRecord ({ record = null, operator }) {
  const output = {
    ...record,
    metadata: record?.metadata ?? {},
    operator,
    parcelles: featureCollection((record?.parcelles?.features ?? [])
      .map(populateWithCommunesLabels)
      .map(populateWithMultipleCultures)
    )
  }

  return output
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
  normalizeEtatProduction,
  EtatProduction
}
