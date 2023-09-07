'use strict'

const { featureCollection } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const memo = require('p-memoize')
const { get } = require('got')

const pool = require('../db.js')
const config = require('../config.js')
const { EtatProduction, fetchOperatorById } = require('./agence-bio.js')
const { populateWithMetadata } = require('../outputs/operator.js')
const { deepMergeObjects, updateCollectionFeatures } = require('../outputs/features.js')
const { normalizeRecord } = require('../outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { CertificationState, EventType, createNewEvent } = require('../history.js')
const { NotFoundApiError } = require('../errors.js')

const ONE_HOUR = 60 * 60 * 1000

/**
 * @typedef {import('geojson').Feature} Feature
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').GeoJsonProperties} FeatureProperties
 * @typedef {import('../history.js').HistoryEntry} HistoryEntry
 */

/* eslint-disable-next-line quotes */
const recordFields = /* sqlFragment */`record_id, numerobio, operator_id, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, parcelles, metadata, audit_history, audit_notes, audit_demandes`

/**
 * Create a new record unless we find a dangling one
 *
 * TODO: maybe in the future we will update from scratch a dangling record by its Id
 * @param {{ numeroBio: String, ocId: Integer, ocLabel: String, metadata: RecordMetadata, geojson: import('@turf/helpers').FeatureCollection, historyEvent=: HistoryEntry}} patchData
 * @returns {OperatorRecord}
 */
async function createOperatorRecord ({ operatorId, decodedToken, record }, { numeroBio, ocId, ocLabel, geojson, metadata }) {
  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_CREATE,
    { features: geojson.features, state: CertificationState.OPERATOR_DRAFT, metadata },
    { decodedToken, record }
  )

  let result = null
  const { state: certificationState } = historyEntry

  // in case we delete + imported a data again
  if (record.record_id) {
    const { audit_history: auditHistory } = record
    auditHistory.push(historyEntry)

    result = await pool.query(/* sql */`UPDATE cartobio_operators
      SET (numerobio, oc_id, oc_label, updated_at, metadata, parcelles, certification_state, audit_history)
      = ($2, $3, $4, $5, $6, $7, $8, $9)
      WHERE record_id = $1
      RETURNING ${recordFields}`,
    [record.record_id, numeroBio, ocId, ocLabel, 'now', metadata, geojson, certificationState, JSON.stringify(auditHistory)])
  // import from scratch
  } else {
    result = await pool.query(/* sql */`INSERT INTO cartobio_operators
      (operator_id, numerobio, oc_id, oc_label, created_at, metadata, parcelles, certification_state, audit_history)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, jsonb_build_array($9::jsonb))
      RETURNING ${recordFields}`,
    [operatorId, numeroBio, ocId, ocLabel, 'now', metadata, geojson, certificationState, historyEntry])
  }

  return result.rows.at(0)
}

/**
 *
 * @param {*} param0
 * @param {Feature[]} features
 * @returns {OperatorRecord}
 */
async function patchFeatureCollection ({ decodedToken, record }, features) {
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_UPDATE,
    { features },
    { decodedToken, record }
  )

  const parcelles = featureCollection(deepMergeObjects(record.parcelles.features, features))
  const { rows: updatedRows } = await pool.query(/* sql */`UPDATE cartobio_operators SET
    updated_at = now(), parcelles = $2::jsonb, audit_history = (audit_history || coalesce($3, '[]')::jsonb)
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [record.record_id, parcelles, historyEntry])

  return updatedRows.at(0)
}

/**
 *
 * @param {{ recordId: string, featureId: number, decodedToken: Object}} identifiers
 * @param {Feature} feature
 * @returns {OperatorRecord}
 */
async function updateFeatureProperties ({ featureId, decodedToken, record }, { properties }) {
  const feature = { id: featureId, properties }
  const matchingFeature = record.parcelles.features.find(({ id }) => id === featureId)

  if (!matchingFeature) {
    throw new NotFoundApiError('Parcelle introuvable')
  }

  const historyEntry = createNewEvent(
    EventType.FEATURE_UPDATE,
    { features: [feature] },
    { decodedToken, record }
  )

  const updatedFeature = deepMergeObjects(matchingFeature, feature, deepMergeObjects.DROP_MISSING_IDS)
  const parcelles = updateCollectionFeatures(record.parcelles, [updatedFeature])

  const { rows: updatedRows } = await pool.query(/* sql */`UPDATE cartobio_operators
    SET updated_at = now(), parcelles = $2, audit_history = (audit_history || coalesce($3, '[]')::jsonb)
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [
    record.record_id,
    parcelles,
    historyEntry
  ])

  return updatedRows.at(0)
}

async function addRecordFeature ({ decodedToken, record }, feature) {
  const newId = Date.now()

  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_CREATE,
    { features: [feature], description: `Parcelle ${feature.properties.cadastre} ajoutée` },
    { decodedToken, record }
  )

  const { rows: updatedRows } = await pool.query(/* sql */`UPDATE cartobio_operators
    SET updated_at = now(), parcelles['features'] = (parcelles->'features' || $2::jsonb), audit_history = (audit_history || coalesce($3, '[]')::jsonb)
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [
    record.record_id,
    { ...feature, id: newId, properties: { ...feature.properties, id: newId } },
    historyEntry
  ])

  return updatedRows.at(0)
}

async function getOperator (operatorId) {
  const [result, operator] = await Promise.all([
    pool.query(`SELECT ${recordFields} FROM cartobio_operators WHERE operator_id = $1 LIMIT 1`, [operatorId]),
    fetchOperatorById(operatorId)
  ])

  const [record] = result.rows

  if (!record && !operator) {
    return null
  }

  return normalizeRecord({ record, operator })
}

async function getRecord (recordId) {
  const result = await pool.query(/* sql */`SELECT ${recordFields} FROM cartobio_operators WHERE record_id = $1 LIMIT 1`, [recordId])
  const [record] = result.rows

  if (!record) {
    return null
  }

  const operator = await fetchOperatorById(record.operator_id)

  return normalizeRecord({ record, operator })
}

async function deleteRecord ({ decodedToken, record }) {
  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_DELETE,
    { },
    { decodedToken, record }
  )

  const result = await pool.query(/* sql */`UPDATE cartobio_operators
    SET updated_at = now(), parcelles = NULL, certification_date_debut = NULL, certification_date_fin = NULL, certification_state = NULL, metadata = '{}'::jsonb, audit_history = (audit_history || coalesce($2, '[]')::jsonb)
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [record.record_id, historyEntry])

  return result.rows.at(0)
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

async function updateAuditRecordState ({ decodedToken, record }, patch) {
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
    values.push(createNewEvent(
      EventType.CERTIFICATION_STATE_CHANGE,
      { state },
      { decodedToken, record }
    ))
  }

  const { rows } = await pool.query(/* sql */`UPDATE cartobio_operators
    SET (${columns.join(', ')}) = (${placeholders.join(', ')})
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [record.record_id, ...values])

  return rows.at(0)
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
  addRecordFeature,
  createOperatorRecord,
  fetchLatestCustomersByControlBody,
  getOperator,
  getDataGouvStats: memo(getDataGouvStats, { maxAge: 6 * ONE_HOUR }),
  getParcellesStats: memo(getParcellesStats, { maxAge: 6 * ONE_HOUR }),
  getRecord,
  deleteRecord,
  pacageLookup,
  patchFeatureCollection,
  updateAuditRecordState,
  updateFeatureProperties
}
