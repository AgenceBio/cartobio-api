'use strict'

/**
 * @typedef {@import('../providers/agence-bio.d.ts').Operator} Operator
 * @typedef {@import('../providers/agence-bio.d.ts').numeroBio} numeroBio
 */

const pool = require('../db.js')

const ALLOWED_PROPERTIES = [
  'pacage',
  'bio',
  'numilot',
  'numparcel',
  'codecultu'
]

/**
 * Pick the allowed properties from a GeoJSON properties object
 *
 * @param  {<Object>} properties [description]
 * @return {Object}            [description]
 */
function pick (properties) {
  return ALLOWED_PROPERTIES.reduce((obj, prop) => ({
    ...obj,
    [prop]: properties[prop]
  }), {})
}

/**
 * Decorate GeoJSON Features
 * @param  {{customerData: Array.<Operator>}} options [description]
 * @return {function(Array.<GeoJSONFeature>): Array.<GeoJSONFeature>}          [description]
 */
function decorate ({ customerData }) {
  return function decorateWithCustomerData (features) {
    return features.map(({ type, geometry, properties }) => ({
      type,
      geometry,
      properties: {
        ...pick(properties),
        numerobio: customerData.find(({ numeroPacage }) => numeroPacage === properties.pacage).numeroBio
      }
    }))
  }
}

/**
 * Populate third party informations with our very own operators data
 *
 * @param  {Array.<numeroBio>} operators An array of objects fetched from the Agence Bio Notifications portal
 * @return {[type]}           The same array, merged with our own local data
 */
async function populateWithMetadata (operators) {
  const ids = operators.map(({ id }) => id)

  if (ids.length === 0) {
    return operators
  }

  return pool
    .query(`SELECT record_id, created_at, operator_id, certification_state, metadata FROM cartobio_operators WHERE operator_id IN (${ids.join(',')})`)
    .then(({ rows }) => {
      return operators.map(agenceBioOperatorData => {
        const { metadata: cartobioOperatorData, ...record } = rows.find(({ operator_id: id }) => id === agenceBioOperatorData.id) || { metadata: {} }

        return {
          ...agenceBioOperatorData,
          ...cartobioOperatorData,
          ...record
        }
      })
    })
}

module.exports = { decorate, populateWithMetadata }
