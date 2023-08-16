'use strict'

const { featureCollection } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const memo = require('p-memoize')
const { get } = require('got')
const { all: deepmerge } = require('deepmerge')

const pool = require('../db.js')
const config = require('../config.js')
const { EtatProduction, fetchOperatorById } = require('./agence-bio.js')
const { populateWithMetadata } = require('../outputs/operator.js')
const { populateWithCentroid, populateWithMultipleCultures } = require('../outputs/features.js')
const { randomUUID } = require('crypto')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { EventType, createNewEvent } = require('../history.js')

const ONE_HOUR = 60 * 60 * 1000

/**
 * @typedef {import('../history.js').HistoryEntry} HistoryEntry
 */

/**
 * @enum {string}
 */
const CertificationState = {
  OPERATOR_DRAFT: 'OPERATOR_DRAFT', // Phase 2
  AUDITED: 'AUDITED', // Phase 3
  PENDING_CERTIFICATION: 'PENDING_CERTIFICATION', // Phase 4
  CERTIFIED: 'CERTIFIED', // Phase 5
}

/**
 * @param {{ operatorId: String }} query
 * @param {{ numeroBio: String, ocId: Integer, ocLabel: String, metadata: RecordMetadata, geojson: import('@turf/helpers').FeatureCollection, historyEvent=: HistoryEntry}} patchData
 * @returns {OperatorRecord}
 */
async function updateOperatorParcels ({ operatorId }, { numeroBio, ocId, ocLabel, geojson, metadata, historyEvent }) {
  const { rows } = await pool.query('SELECT * FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId])
  const recordAlreadyExists = Boolean(rows.length)

  let returnedRecord
  const mergedData = {
    ...(recordAlreadyExists ? rows[0].metadata : {}),
    ...metadata
  }

  if (!recordAlreadyExists) {
    const auditHistory = historyEvent ?? {
      state: CertificationState.OPERATOR_DRAFT,
      date: new Date().toISOString(),
      ...(metadata.provenance ? { provenance: metadata.provenance } : {})
    }
    const { state: certificationState } = auditHistory

    const result = await pool.query('INSERT INTO cartobio_operators (operator_id, numerobio, oc_id, oc_label, created_at, metadata, parcelles, certification_state, audit_history) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, jsonb_build_array($9::jsonb)) RETURNING record_id, certification_date_debut, certification_date_fin, certification_state, audit_history', [operatorId, numeroBio, ocId, ocLabel, 'now', mergedData, geojson, certificationState, auditHistory])
    returnedRecord = result.rows[0]
  } else {
    // we inherit from a given state, or we keep the existing one
    const certificationState = historyEvent?.state ?? rows[0].certification_state

    // TODO update by recordId
    const result = await pool.query('UPDATE cartobio_operators set updated_at = $2, metadata = $3, certification_state = $4, parcelles = $5 WHERE operator_id = $1 RETURNING record_id, certification_date_debut, certification_date_fin, certification_state, audit_history', [operatorId, 'now', mergedData, certificationState, geojson])
    returnedRecord = result.rows[0]
  }

  return { ...returnedRecord, metadata: mergedData, parcelles: geojson }
}

async function patchOperatorFeatures ({ operatorId, decodedToken }, features) {
  const result = await pool.query('SELECT record_id, parcelles, certification_state FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId])
  const record = result.rows.at(0)

  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_UPDATE,
    { features },
    {},
    { decodedToken }
  )

  const parcelles = deepmerge([record.parcelles, { features }])
  const { rows: updatedRows } = await pool.query('UPDATE cartobio_operators set updated_at = now(), parcelles = $2::jsonb, audit_history = (audit_history || $3::jsonb) WHERE operator_id = $1 RETURNING record_id, certification_state, audit_history, metadata, parcelles', [
    operatorId,
    parcelles,
    historyEntry
  ])

  return updatedRows.at(0)
}

async function addNewOperatorParcel ({ operatorId, decodedToken }, feature) {
  const { rows } = await pool.query('SELECT record_id FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId])
  const newId = Date.now()

  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_CREATE,
    { features: [feature] },
    { description: `Nouvelle parcelle ${feature.properties.cadastre} ajoutée` },
    { decodedToken }
  )

  const { rows: updatedRows } = await pool.query("UPDATE cartobio_operators set updated_at = now(), parcelles['features'] = (parcelles->'features' || $2::jsonb), audit_history = (audit_history || $3::jsonb) WHERE operator_id = $1 RETURNING record_id, certification_date_debut, certification_date_fin, certification_state, audit_history, metadata, parcelles", [
    operatorId,
    { ...feature, id: newId, properties: { ...feature.properties, id: newId } },
    historyEntry
  ])

  return updatedRows[0]
}

async function getOperator ({ operatorId }) {
  const [result, operator] = await Promise.all([
    pool.query('SELECT record_id, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, parcelles, metadata, audit_history, audit_notes, audit_demandes FROM cartobio_operators WHERE operator_id = $1 LIMIT 1', [operatorId]),
    fetchOperatorById(operatorId)
  ])

  const [record = {}] = result.rows

  return {
    ...record,
    operator,
    metadata: record.metadata ?? {},
    parcelles: featureCollection(record.parcelles
      ? record.parcelles.features.map(populateWithCentroid).map(populateWithMultipleCultures)
      : []
    )
  }
}

async function deleteRecord ({ operatorId }) {
  await pool.query('DELETE FROM cartobio_operators WHERE operator_id = $1', [operatorId])
}

async function pacageLookup ({ numeroPacage }) {
  const { rows } = await pool.query('SELECT ST_AsGeoJSON(geom, 15)::json AS geometry, num_ilot as "NUMERO_I", num_parcel as "NUMERO_P", bio as "BIO", code_cultu AS "TYPE", precision AS "PRECISION", fid FROM rpg_bio WHERE pacage = $1', [numeroPacage])
  return toWgs84({
    type: 'FeatureCollection',
    features: rows.map(({ geometry, fid: id, NUMERO_I, NUMERO_P, PRECISION, TYPE, BIO }) => ({
      type: 'Feature',
      id,
      remoteId: id,
      geometry,
      // signature close to the output of lib/providers/telepac.js
      properties: {
        id,
        BIO,
        cultures: [
          {
            id: randomUUID(),
            CPF: fromCodePacStrict(TYPE)?.code_cpf,
            TYPE,
            variete: PRECISION ?? ''
          }
        ],
        NUMERO_I,
        NUMERO_P,
        PACAGE: numeroPacage,
        conversion_niveau: BIO === 1 ? 'AB?' : EtatProduction.NB
      }
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

  Object.entries(patch).forEach(([field, value]) => {
    columns.push(field)
    placeholders.push(`$${columns.length + 1}`)
    values.push(value)
  })

  if (state) {
    columns.push('audit_history')
    placeholders.push(`audit_history || $${columns.length + 1}::jsonb`)
    values.push({ state, date: new Date().toISOString() })
  }

  const { rows } = await pool.query(`UPDATE cartobio_operators SET (${columns.join(', ')}) = (${placeholders.join(', ')}) WHERE record_id = $1 RETURNING record_id, audit_history, certification_date_debut, certification_date_fin, certification_state`, [
    recordId,
    ...values
  ])

  return rows[0]
}

/**
 * @returns {Promise.<{count: Number, parcelles_count: Number}>} result
 */
async function getParcellesStats () {
  const { rows } = await pool.query("SELECT COUNT(parcelles) as count, SUM(JSONB_ARRAY_LENGTH(parcelles->'features')::bigint) as parcelles_count FROM cartobio_operators WHERE metadata->>'source' != '';")

  return rows[0]
}

/**
 * @returns {Promise.<{resources:{metrics:{views: Number}}[]}>}
 */
async function getDataGouvStats () {
  try {
    return await get(config.get('datagouv.datasetApiUrl')).json()
  } catch (error) {
    return {}
  }
}

module.exports = {
  addNewOperatorParcel,
  fetchLatestCustomersByControlBody,
  getOperator,
  getDataGouvStats: memo(getDataGouvStats, { maxAge: 6 * ONE_HOUR }),
  getParcellesStats: memo(getParcellesStats, { maxAge: 6 * ONE_HOUR }),
  deleteRecord,
  pacageLookup,
  patchOperatorFeatures,
  updateOperatorParcels,
  updateAuditRecordState
}
