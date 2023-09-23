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

module.exports = { populateWithMetadata }
