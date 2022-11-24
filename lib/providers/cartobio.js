'use strict'

const { featureCollection } = require('@turf/helpers')

const pool = require('../db.js')
const { fetchCustomersByOperator } = require('./agence-bio.js')

/**
 * Patch
 * @param  {[type]} numeroBio [description]
 * @param  {[type]} data      [description]
 * @return {Promise} PGPromise
 */
async function updateOperator ({ ocId, numeroBio }, data) {
  const [operator, result] = await Promise.all([
    fetchCustomersByOperator({ ocId, numeroBio }).then(all => all[0]),
    pool.query('SELECT numerobio, metadata FROM cartobio_operators WHERE numerobio = $1 LIMIT 1', [numeroBio])
  ])

  if (!operator) {
    throw new Error(`Operator ${numeroBio} is not managed by ${ocId}, cannot continue.`)
  }

  const recordAlreadyExists = Boolean(result.rows.length)
  const mergedData = {
    ...(recordAlreadyExists ? result.rows[0].metadata : {}),
    ...data
  }

  // updatedData[value] = mergedData[key] === 'none' ? '' : mergedData[key]
  if (!recordAlreadyExists) {
    await pool.query('INSERT INTO cartobio_operators (numerobio, metadata) VALUES ($1, $2)', [numeroBio, mergedData])
  } else {
    await pool.query('UPDATE cartobio_operators set metadata = $2 WHERE numerobio = $1', [numeroBio, mergedData])
  }

  // Postgres 9.5+
  // await pool.query(`INSERT INTO cartobio_operators (numerobio, metadata) VALUES ($1, $2)
  //                    ON CONFLICT ON CONSTRAINT cartobio_operators_pkey
  //                    DO UPDATE SET pacage = $2`, [numeroBio, mergedData])

  return mergedData
}

async function updateOperatorParcels ({ operatorId }, { numeroBio, ocId, ocLabel, geojson, metadata }) {
  const { rows } = await pool.query('SELECT * FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId])
  const recordAlreadyExists = Boolean(rows.length)

  let returnedRecord
  const mergedData = {
    ...(recordAlreadyExists ? rows[0].metadata : {}),
    ...metadata
  }

  if (!recordAlreadyExists) {
    const { rows } = await pool.query('INSERT INTO cartobio_operators (operator_id, numerobio, oc_id, oc_label, created_at, metadata, parcelles) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING record_id, certification_state', [operatorId, numeroBio, ocId, ocLabel, 'now', mergedData, geojson])
    returnedRecord = rows[0]
  } else {
    // TODO update by recordId
    const { rows } = await pool.query('UPDATE cartobio_operators set updated_at = $2, numerobio = $3, metadata = $4, parcelles = $5 WHERE operator_id = $1 RETURNING record_id, certification_state', [operatorId, 'now', numeroBio, mergedData, geojson])
    returnedRecord = rows[0]
  }

  return { ...returnedRecord, metadata: mergedData, parcelles: geojson }
}

async function getOperator ({ operatorId }) {
  const { rows } = await pool.query('SELECT record_id, certification_state, created_at, updated_at, parcelles, metadata FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId])

  return rows[0] ?? {
    parcelles: featureCollection([]),
    metadata: {}
  }
}

async function fetchLatestCustomersByControlBody ({ ocId }) {
  const { rows } = await pool.query('SELECT numerobio FROM cartobio_operators WHERE oc_id = $1 ORDER BY updated_at DESC LIMIT 10;', [ocId])
  const ids = rows.map(({ numerobio }) => numerobio)

  const operators = await Promise.all(
    ids.map(numeroBio => fetchCustomersByOperator({ ocId, numeroBio }))
  )
    // responses => operators
    // [ [{}], [], [{}] ] => [ {}, {} ]
    .then((...responses) => [].concat(...responses.flat()))

  return operators
}

module.exports = {
  fetchLatestCustomersByControlBody,
  getOperator,
  updateOperator,
  updateOperatorParcels
}
