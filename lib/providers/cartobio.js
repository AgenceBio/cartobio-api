'use strict'

const { featureCollection } = require('@turf/helpers')

const pool = require('../db.js')
const { fetchCustomersByOperator, fetchOperatorById } = require('./agence-bio.js')
const { populateWithMetadata } = require('../outputs/operator.js')

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
    const { rows } = await pool.query('INSERT INTO cartobio_operators (operator_id, numerobio, oc_id, oc_label, created_at, metadata, parcelles) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING record_id, certification_state, audit_history', [operatorId, numeroBio, ocId, ocLabel, 'now', mergedData, geojson])
    returnedRecord = rows[0]
  } else {
    // TODO update by recordId
    const { rows } = await pool.query('UPDATE cartobio_operators set updated_at = $2, numerobio = $3, metadata = $4, parcelles = $5 WHERE operator_id = $1 RETURNING record_id, certification_state, audit_history', [operatorId, 'now', numeroBio, mergedData, geojson])
    returnedRecord = rows[0]
  }

  return { ...returnedRecord, metadata: mergedData, parcelles: geojson }
}

async function getOperator ({ operatorId }) {
  const [result, operator] = await Promise.all([
    pool.query('SELECT record_id, certification_state, created_at, updated_at, parcelles, metadata, audit_history, audit_notes, audit_demandes FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId]),
    fetchOperatorById(operatorId)
  ])

  return {
    parcelles: featureCollection([]),
    metadata: {},
    operator,
    ...result.rows[0]
  }
}

async function fetchLatestCustomersByControlBody ({ ocId }) {
  const { rows } = await pool.query('SELECT operator_id FROM cartobio_operators WHERE oc_id = $1 ORDER BY updated_at DESC LIMIT 10;', [ocId])
  const ids = rows.map(({ operator_id: id }) => id).filter(d => d)

  const operators = await Promise.allSettled(
    ids.map(operatorId => fetchOperatorById(operatorId))
  )
    // responses => operators
    // [ [{ status: 'fulfilled', 'value': {...}}}], [{status: 'rejected'}], [{…}] ] => [ {}, {} ]
    .then(responses => responses.map(({ value }) => value))
    .then(operators => operators.filter(d => d))
    .then(operators => populateWithMetadata(operators))

  return operators
}

async function updateAuditRecordState (recordId, patch) {
  const { certification_state: state } = patch
  const columns = ['updated_at']
  const placeholders = ['$2']
  const values = ['NOW()']

  const ALLOWED_FIELDS = [
    'certification_state',
    'audit_notes',
    'audit_demandes'
  ]

  ALLOWED_FIELDS.forEach((field) => {
    if (field in patch) {
      columns.push(field)
      placeholders.push(`$${columns.length + 1}`)
      values.push(patch[field])
    }
  })

  if (state) {
    columns.push('audit_history')
    placeholders.push(`audit_history || $${columns.length + 1}::jsonb`)
    values.push({ state, date: new Date().toISOString() })
  }

  const { rows } = await pool.query(`UPDATE cartobio_operators SET (${columns.join(', ')}) = (${placeholders.join(', ')}) WHERE record_id = $1 RETURNING record_id, certification_state, audit_history`, [
    recordId,
    ...values
  ])

  return rows[0]
}

module.exports = {
  fetchLatestCustomersByControlBody,
  getOperator,
  updateOperator,
  updateOperatorParcels,
  updateAuditRecordState
}
