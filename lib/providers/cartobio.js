'use strict'

const pool = require('../db.js')

/**
 * Populate third party informations with our very own operators data
 *
 * @param  {Array.<numeroBio>} operators An array of objects fetched from the Agence Bio Notifications portal
 * @return {[type]}           The same array, merged with our own local data
 */
function populateWithMetadata (operators) {
  const ids = operators.map(({ numeroBio }) => numeroBio)

  return pool
    .query(`SELECT numerobio, pacage FROM cartobio_operators WHERE numerobio IN (${ids.join(',')})`)
    .then(({ rows }) => {
      return operators.map(operator => {
        const metadata = rows.find(({ numerobio }) => numerobio === operator.numeroBio)

        return {
          ...operator,
          // the output logic here is:
          // non-empty string: pacage id
          // empty string: we know they have no pacage id
          // null: we do not know if they have a pacage id, or not
          numeroPacage: (metadata && typeof metadata.pacage === 'string' ? metadata.pacage : operator.numeroPacage)
        }
      })
    })
}

module.exports = {
  populateWithMetadata
}
