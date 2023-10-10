const { featureCollection } = require('@turf/helpers')
const { populateWithCentroid, populateWithMultipleCultures } = require('./features.js')

/**
 * @typedef {DBOperatorRecord} NormalizedRecord
 * @property {Object} metadata
 * @property {AgenceBioNormalizedOperator} operator
 * @property {FeatureCollection<G, P>} parcelles
 */

/**
 * Normalize a record
 * @param {DBOperatorRecord} record
 * @param {AgenceBioNormalizedOperator} operator
 * @returns {NormalizedRecord}
 */
function normalizeRecord ({ record = null, operator }) {
  const output = {
    ...record,
    metadata: record?.metadata ?? {},
    operator,
    parcelles: featureCollection((record?.parcelles?.features ?? [])
      .map(populateWithCentroid)
      .map(populateWithMultipleCultures)
    )
  }

  delete output.record?.metadata
  delete output.record?.parcelles

  return output
}

module.exports = {
  normalizeRecord
}
