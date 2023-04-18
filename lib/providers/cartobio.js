'use strict'

const { featureCollection } = require('@turf/helpers')
const { toWgs84 } = require('reproject')

const pool = require('../db.js')
const { fetchOperatorById } = require('./agence-bio.js')
const { populateWithCentroid, populateWithMetadata } = require('../outputs/operator.js')

async function updateOperatorParcels ({ operatorId }, { numeroBio, ocId, ocLabel, geojson, metadata }) {
  const { rows } = await pool.query('SELECT * FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId])
  const recordAlreadyExists = Boolean(rows.length)

  let returnedRecord
  const mergedData = {
    ...(recordAlreadyExists ? rows[0].metadata : {}),
    ...metadata
  }

  if (!recordAlreadyExists) {
    const auditHistory = { state: 'OPERATOR_DRAFT', date: new Date().toISOString() }
    const { rows } = await pool.query('INSERT INTO cartobio_operators (operator_id, numerobio, oc_id, oc_label, created_at, metadata, parcelles, audit_history) VALUES ($1, $2, $3, $4, $5, $6, $7, jsonb_build_array($8::jsonb)) RETURNING record_id, certification_state, audit_history', [operatorId, numeroBio, ocId, ocLabel, 'now', mergedData, geojson, auditHistory])
    returnedRecord = rows[0]
  } else {
    // TODO update by recordId
    const { rows } = await pool.query('UPDATE cartobio_operators set updated_at = $2, metadata = $3, parcelles = $4 WHERE operator_id = $1 RETURNING record_id, certification_state, audit_history', [operatorId, 'now', mergedData, geojson])
    returnedRecord = rows[0]
  }

  return { ...returnedRecord, metadata: mergedData, parcelles: geojson }
}

async function getOperator ({ operatorId }) {
  const [result, operator] = await Promise.all([
    pool.query('SELECT record_id, certification_state, created_at, updated_at, parcelles, metadata, audit_history, audit_notes, audit_demandes FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId]),
    fetchOperatorById(operatorId)
  ])

  const { metadata, parcelles } = result.rows[0] ?? {}
  /* eslint-disable-next-line camelcase */
  const { certification_state, audit_history, audit_notes, audit_demandes } = result.rows[0] ?? {}
  /* eslint-disable-next-line camelcase */
  const { created_at, record_id, updated_at } = result.rows[0] ?? {}

  return {
    parcelles: parcelles ? populateWithCentroid(parcelles) : featureCollection([]),
    metadata: metadata ?? {},
    operator,
    record_id,
    created_at,
    updated_at,
    certification_state,
    audit_history,
    audit_notes,
    audit_demandes
  }
}

async function pacageLookup ({ numeroPacage }) {
  const { rows } = await pool.query('SELECT ST_AsGeoJSON(geom, 15)::json AS geometry, num_ilot as "NUMERO_I", num_parcel as "NUMERO_P", bio as "BIO", code_cultu AS "TYPE", fid FROM rpg_bio WHERE pacage = $1', [numeroPacage])
  return toWgs84({
    type: 'FeatureCollection',
    features: rows.map(({ geometry, fid: id, ...properties }) => ({
      type: 'Feature',
      id,
      geometry,
      properties: { id, ...properties }
    }))
  }, 'EPSG:3857')
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
  pacageLookup,
  updateOperatorParcels,
  updateAuditRecordState
}
