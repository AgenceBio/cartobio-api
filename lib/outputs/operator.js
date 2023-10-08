'use strict'

/**
 * @typedef {@import('../providers/agence-bio.d.ts').Operator} Operator
 * @typedef {@import('../providers/agence-bio.d.ts').numeroBio} numeroBio
 */

const pool = require('../db.js')

/**
 * Populate third party informations with our very own operators data
 *
 * @param  {Array.<numeroBio>} operators An array of objects fetched from the Agence Bio Notifications portal
 * @return {[type]}           The same array, merged with our own local data
 */
async function populateWithMetadata (operators) {
  const ids = operators.map(({ numeroBio }) => String(numeroBio))

  if (ids.length === 0) {
    return operators
  }

  return pool
    .query('SELECT record_id, created_at, operator_id, numerobio, certification_state, metadata FROM cartobio_operators WHERE numerobio = ANY ($1)', [ids])
    .then(({ rows }) => {
      return operators.map(agenceBioOperatorData => {
        const { metadata: cartobioOperatorData, ...record } = rows.find(({ numerobio }) => numerobio === String(agenceBioOperatorData.numeroBio)) || { metadata: {} }

        return {
          ...agenceBioOperatorData,
          ...cartobioOperatorData,
          ...record
        }
      })
    })
}

module.exports = { populateWithMetadata }
