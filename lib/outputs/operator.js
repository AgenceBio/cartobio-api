'use strict'

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
 * @param  {{customerData: Array.<Operator>, ocId: Number}} options [description]
 * @return {function(Array.<GeoJSONFeature>): Array.<GeoJSONFeature>}          [description]
 */
function decorate ({ customerData, ocId }) {
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
function populateWithMetadata (operators) {
  const ids = operators.map(({ numeroBio }) => numeroBio)

  if (ids.length === 0) {
    return Promise.resolve(operators)
  }

  return pool
    .query(`SELECT numerobio, metadata FROM cartobio_operators WHERE numerobio IN (${ids.join(',')})`)
    .then(({ rows }) => {
      return operators.map(agenceBioOperatorData => {
        const { metadata: cartobioOperatorData } = rows.find(({ numerobio }) => numerobio === agenceBioOperatorData.numeroBio) || { metadata: {} }

        return {
          ...agenceBioOperatorData,
          ...cartobioOperatorData
        }
      })
    })
}

module.exports = { decorate, populateWithMetadata }
