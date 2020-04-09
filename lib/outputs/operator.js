'use strict'

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

module.exports = { decorate }
