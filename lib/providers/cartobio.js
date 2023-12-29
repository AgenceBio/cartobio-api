'use strict'

const { featureCollection, polygon } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const memo = require('p-memoize')
const { get } = require('got')
const JSONStream = require('jsonstream-next')

const pool = require('../db.js')
const config = require('../config.js')
const { EtatProduction, normalizeEtatProduction, parsePacDetailsFromComment, fetchOperatorByNumeroBio } = require('./agence-bio.js')
const { populateWithRecords } = require('../outputs/operator.js')
const { deepMergeObjects, updateCollectionFeatures } = require('../outputs/features.js')
const { normalizeRecord } = require('../outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { CertificationState, EventType, createNewEvent } = require('../history.js')
const { NotFoundApiError } = require('../errors.js')
const { InvalidRequestApiError } = require('../errors')
const { getRandomFeatureId } = require('../outputs/features')

const ONE_HOUR = 60 * 60 * 1000

/**
 * @typedef {import('geojson').Feature} Feature
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').GeoJsonProperties} FeatureProperties
 * @typedef {import('geojson').Polygon} Polygon
 * @typedef {import('../history.js').HistoryEntry} HistoryEntry
 *
 * A decoded JWT attached to a request, either an operator or an Agence Bio SSO user
 * @typedef {AgenceBioOperator | AgenceBioOCUser} DecodedToken
 */

/**
 * An operator record as we store it in CartoBio database
 * @typedef {Object} DBOperatorRecord
 * @property {number} record_id
 * @property {string} numerobio
 * @property {number} operator_id
 * @property {string} certification_date_debut
 * @property {string} certification_date_fin
 * @property {string} certification_state
 * @property {string} created_at
 * @property {string} updated_at
 * @property {FeatureCollection} parcelles
 * @property {Object} metadata
 * @property {HistoryEntry[]} audit_history
 * @property {string} audit_notes
 * @property {string} audit_demandes
 */

/* eslint-disable-next-line quotes */
const recordFields = /* sqlFragment */`record_id, numerobio, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, parcelles, metadata, audit_history, audit_notes, audit_demandes`
/* eslint-disable-next-line quotes */
const partialRecordFields = /* sqlFragment */`certification_state, created_at, numerobio, metadata, record_id, updated_at`

/**
 * Create a new record unless we find a dangling one with the same numeroBio, in which case we update it
 * with the merge algorithm described in ../../docs/rfc/001-api-parcellaire.md
 *
 * @param {Object} data
 * @param {String} data.numeroBio
 * @param {Integer} data.ocId
 * @param {String} data.ocLabel
 * @param {Object} [data.metadata]
 * @param {import('@turf/helpers').FeatureCollection} data.geojson
 * @param {String} [data.certificationState]
 * @param {Object} [context]
 * @param {DecodedToken} [context.decodedToken]
 * @param {DBOperatorRecord} [context.oldRecord]
 * @param {Date} [context.date]
 * @param {import('pg').Client} [client]
 * @returns {Promise<DBOperatorRecord>}
 */
async function createOrUpdateOperatorRecord (data, context, client) {
  const { decodedToken, oldRecord } = context || {}
  const { numeroBio, ocId, ocLabel, metadata, geojson } = data

  const certificationState = data.certificationState || CertificationState.OPERATOR_DRAFT

  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_CREATE,
    { features: geojson.features, state: certificationState, metadata, date: context.date },
    { decodedToken, record: oldRecord }
  )

  let result = null

  try {
    /*
    Code un peu tordu, mais qui permet, en une requête, de mettre à jour des opérateurs existants,
    tout en s'assurant que leur numerobio ne change pas dans le temps, que l'on connaisse ou non
    leur operator_id.

    Ainsi du point de vue SQL :
    * si on tente d'insérer un opérateur avec un nouveau numerobio, l'operator_id doit être vide
    ou ne pas déjà exister
    * si on tente d'insérer un opérateur avec un numerobio déjà existant, la ligne n'est
    modifiée que si l'operator_id est vide ou correspond à l'opérateur existant.

    Dis autrement (du point de vue de la fonction) :
    * si l'operator_id est renseigné, mais n'existe pas déjà, le numerobio doit être nouveau
    * si l'operator_id est renseigné et existe déjà, le numerobio mais doit être le même qu'avant
    * si l'operator_id est vide ou, le numerobio peut être nouveau ou existant
    */
    result = await (client || pool).query(
      /* sql */` WITH merged_features AS (
            SELECT coalesce(jsonb_agg((SELECT coalesce(old_features, '{}'::jsonb) || new_features - 'properties' || jsonb_build_object(
                'properties', coalesce(old_features->'properties', '{}'::jsonb) || new_features->'properties')
            )), '[]'::jsonb) AS features
            FROM cartobio_operators, jsonb_array_elements($6::jsonb->'features') AS new_features
            LEFT JOIN jsonb_array_elements(cartobio_operators.parcelles->'features') AS old_features
            ON (new_features->>'id')::bigint = (old_features ->>'id')::bigint
            WHERE numerobio = $1
        )
        INSERT INTO cartobio_operators
            (numerobio, oc_id, oc_label, created_at, metadata, parcelles, certification_state, audit_history)
            VALUES ($1, $2, $3, $4, $5, $6, $7, jsonb_build_array($8::jsonb))
        ON CONFLICT (numerobio)
            DO UPDATE
            SET (oc_id, oc_label, updated_at, metadata, parcelles, certification_state, audit_history)
               = (SELECT $2, $3, $4, $5, jsonb_build_object(
                        'type', 'FeatureCollection',
                        'features', merged_features.features
                    ), $7, (cartobio_operators.audit_history || coalesce($8, '[]')::jsonb)
            FROM merged_features LIMIT 1)
        RETURNING ${recordFields}`,
      // changing the arity will impact server.test.js tests
      [numeroBio, ocId, ocLabel, 'now', metadata, geojson, certificationState, historyEntry]
    )
  } catch (e) {
    /* Unique constraint failed. L'operator_id existe déjà, mais le numerobio est nouveau,
    l'insert échoue sans passer à l'ON CONFLICT. */
    if (e.code === '23505') {
      throw new InvalidRequestApiError('Le numerobio ne peut pas être modifié.')
    }

    if (e.code === 'P0001' && e.message === 'No geometry') {
      throw new InvalidRequestApiError('La donnée géographique est manquante ou invalide.')
    }

    throw e
  }

  /* Le numerobio existait déjà, mais pour un autre operator_id que celui renseigné. */
  if (result.rows.length === 0) {
    throw new InvalidRequestApiError('Opération impossible : le numéro bio est déjà utilisé pour un autre opérateur.')
  }

  return result.rows.at(0)
}

/**
 * @param {{ decodedToken: DecodedToken, record: DBOperatorRecord }}
 * @param {Feature[]} features
 * @returns {Promise<DBOperatorRecord>}
 */
async function patchFeatureCollection ({ decodedToken, record }, features) {
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_UPDATE,
    { features },
    { decodedToken, record }
  )

  const parcelles = updateCollectionFeatures(record.parcelles, features)

  const { rows: updatedRows } = await pool.query(/* sql */`UPDATE cartobio_operators SET
    updated_at = now(), parcelles = $2::jsonb, audit_history = (audit_history || coalesce($3, '[]')::jsonb)
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [record.record_id, parcelles, historyEntry])

  return updatedRows.at(0)
}

/**
 * @param {Number} featureId
 * @param {DecodedToken} decodedToken
 * @param {DBOperatorRecord} record
 * @param {FeatureProperties} properties
 * @param {Polygon} geometry
 * @returns {Promise<DBOperatorRecord>}
 */
async function updateFeature ({ featureId, decodedToken, record }, { properties, geometry }) {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === featureId)

  if (!matchingFeature) {
    throw new NotFoundApiError('Parcelle introuvable')
  }

  const historyEntry = createNewEvent(
    EventType.FEATURE_UPDATE,
    { features: [matchingFeature] },
    { decodedToken, record }
  )

  const updatedFeature = {
    type: 'Feature',
    id: featureId,
    properties: deepMergeObjects(matchingFeature.properties, properties, deepMergeObjects.DROP_MISSING_IDS),
    geometry: geometry || matchingFeature.geometry
  }

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

/**
 * @param {Number} featureId
 * @param {DecodedToken} decodedToken
 * @param {DBOperatorRecord} record
 * @param {Object} reason
 * @param {String} reason.code
 * @param {String} [reason.details]
 * @returns {Promise<DBOperatorRecord>}
 */
async function deleteSingleFeature ({ featureId, decodedToken, record }, { reason }) {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === featureId)

  if (!matchingFeature) {
    throw new NotFoundApiError('Parcelle introuvable')
  }

  const historyEntry = createNewEvent(
    EventType.FEATURE_DELETE,
    { features: [matchingFeature], metadata: { reason, feature: matchingFeature } },
    { decodedToken, record }
  )

  const parcelles = featureCollection(record.parcelles.features.filter(({ id }) => id !== featureId))

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

/**
 * @param {DecodedToken} decodedToken
 * @param {DBOperatorRecord} record
 * @param {Feature} feature
 * @return {Promise<DBOperatorRecord>}
 */
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

async function getOperatorByNumeroBio (numeroBio) {
  const [result, operator] = await Promise.allSettled([
    pool.query(`SELECT ${recordFields} FROM cartobio_operators WHERE numerobio = $1 LIMIT 1`, [numeroBio]),
    fetchOperatorByNumeroBio(numeroBio)
  ])

  const [record] = result.value.rows

  if (!record && operator.status === 'rejected') {
    return null
  }

  return normalizeRecord({ record, operator: operator.value })
}

/**
 * @param {String} recordId
 * @return {Promise<NormalizedRecord|null>}
 */
async function getRecord (recordId) {
  const result = await pool.query(/* sql */`SELECT ${recordFields} FROM cartobio_operators WHERE record_id = $1 LIMIT 1`, [recordId])
  const [record] = result.rows

  if (!record) {
    return null
  }

  const operator = await fetchOperatorByNumeroBio(record.numerobio)

  return normalizeRecord({ record, operator })
}

/**
 * @param {DecodedToken} decodedToken
 * @param {DBOperatorRecord} record
 * @return {Promise<DBOperatorRecord>}
 */
async function deleteRecord ({ decodedToken, record }) {
  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_DELETE,
    { },
    { decodedToken, record }
  )

  const result = await pool.query(/* sql */`UPDATE cartobio_operators
    SET updated_at = now(), parcelles = $3::jsonb, certification_date_debut = NULL, certification_date_fin = NULL, certification_state = NULL, audit_notes = '', metadata = '{}'::jsonb, audit_history = (audit_history || coalesce($2, '[]')::jsonb)
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [record.record_id, historyEntry, featureCollection([])])

  return result.rows.at(0)
}

/**
 * @param {String} numeroPacage
 * @return {Promise<*>}
 */
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
            CPF: fromCodePacStrict(TYPE/*, PRECISION */)?.code_cpf,
            TYPE
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

/**
 * @param {Number} ocId
 * @return {Promise<AgenceBioNormalizedOperator[]>}
 */
async function fetchLatestCustomersByControlBody ({ ocId }) {
  const { rows } = await pool.query(/* sql */`SELECT numerobio
    FROM cartobio_operators
    WHERE oc_id = $1
    ORDER BY updated_at DESC LIMIT 10;`,
  [
    ocId
  ])

  const ids = rows.map(({ numerobio }) => numerobio).filter(d => d)

  return Promise.allSettled(
    ids.map(numerobio => fetchOperatorByNumeroBio(numerobio))
  )
    // responses => operators
    // [ [{ status: 'fulfilled', 'value': {...}}}], [{status: 'rejected'}], [{…}] ] => [ {}, {} ]
    .then(responses => responses.map(({ value }) => value))
    .then(operators => operators.filter(d => d))
    .then(operators => populateWithRecords(operators))
}

/**
 * @param {DecodedToken} decodedToken
 * @param {DBOperatorRecord} record
 * @param {Object} patch
 * @param {String} patch.auditeur_notes
 * @param {String} patch.audit_notes
 * @param {String} patch.audit_demandes
 * @param {String} patch.certification_date_debut
 * @param {String} patch.certification_date_fin
 * @param {Array} patch.cultures
 * @param {String} patch.conversion_niveau
 * @param {String} patch.engagement_date
 * @return {Promise<DBOperatorRecord>}
 */
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
 * @returns {Promise.<{resources:{metrics:{views: Number}}[]}|{}>}
 */
async function getDataGouvStats () {
  try {
    return await get(config.get('datagouv.datasetApiUrl')).json()
  } catch (error) {
    return {}
  }
}

/**
 * @param {NodeJS.ReadableStream} stream - a Json Stream
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @return {Iterable<Object>}
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  /**
   * @type {Promise<ParcellaireApiRecord>[]}
   */
  const streamRecords = stream.pipe(JSONStream.parse([true]))

  for await (const record of streamRecords) {
    if (isNaN(Date.parse(record.dateAudit))) {
      yield [String(record.numeroBio), null, new Error('champ dateAudit incorrect')]
      continue
    }

    let hasFeatureError = null

    const features = record.parcelles
      // turn products into features
      .map(parcelle => {
        const id = !Number.isNaN(parseInt(parcelle.id, 10)) ? parseInt(parcelle.id, 10) : getRandomFeatureId()
        const cultures = parcelle.culture ?? parcelle.cultures
        const pac = parsePacDetailsFromComment(parcelle.commentaire)
        const numeroIlot = parseInt(parcelle.numeroIlot, 10)
        const numeroParcelle = parseInt(parcelle.numeroParcelle, 10)

        const properties = {
          id,
          remoteId: parcelle.id,
          CAMPAGNE: record.anneeReferenceControle,
          cultures: cultures.map(({ codeCPF, quantite, variete = '' }) => ({
            CPF: codeCPF,
            surface: parseFloat(quantite),
            variete
          })),
          NUMERO_I: Number.isNaN(numeroIlot) ? (pac.numeroIlot ?? '') : String(numeroIlot),
          NUMERO_P: Number.isNaN(numeroParcelle) ? (pac.numeroParcelle ?? '') : String(numeroParcelle),
          PACAGE: record.numeroPacage ? String(record.numeroPacage) : '',
          conversion_niveau: normalizeEtatProduction(parcelle.etatProduction),
          engagement_date: parcelle.dateEngagement ?? '',
          auditeur_notes: parcelle.commentaire ?? ''
        }

        let coordinates = ''

        if (parcelle.geom === null || parcelle.geom === undefined || parcelle.geom === '' || parcelle.geom === 'null') {
          return {
            id,
            type: 'Feature',
            properties
          }
        }

        try {
          coordinates = JSON.parse(parcelle.geom.replace(/}$/, ''))
          coordinates.forEach(ring => ring.forEach(([x, y]) => {
            if (y > 90 || y < -90) {
              throw new Error('la latitude doit être comprise entre 90 et -90')
            }

            if (x > 180 || x < -180) {
              throw new Error('la longitude doit être comprise entre 180 et -180')
            }
          }))
        } catch (error) {
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          return {}
        }

        try {
          return polygon(coordinates, properties, { id })
        } catch (error) {
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          return {}
        }
      })

    // known error, we skip the record
    if (hasFeatureError) {
      yield [String(record.numeroBio), null, hasFeatureError]
      continue
    }

    // emit a data structure similar to what `/v2/operator/${numeroBio}/parcelles` consumes
    yield [
      String(record.numeroBio),
      {
        ocId: organismeCertificateur.id,
        ocLabel: organismeCertificateur.nom,
        numeroPacage: String(record.numeroPacage),
        auditDate: new Date(record.dateAudit),
        geojson: {
          type: 'FeatureCollection',
          features
        }
      }
    ]
  }
}

/**
 * @param {NodeJS.ReadableStream} stream
 * @param {OrganismeCertificateur} organismeCertificateur
 * @returns {Promise<{count: number, errors: Error[]}>}
 */
async function parcellaireStreamToDb (stream, organismeCertificateur) {
  const generator = parseAPIParcellaireStream(stream, { organismeCertificateur })
  let count = 0
  const errors = []

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    for await (const [numeroBio, data, error] of generator) {
      count++
      if (error) {
        errors.push([count, error.message])
        continue
      }

      try {
        await createOrUpdateOperatorRecord({
          numeroBio,
          ocId: data.ocId,
          ocLabel: data.ocLabel,
          geojson: data.geojson,
          certificationState: CertificationState.CERTIFIED,
          metadata: {
            source: 'API Parcellaire',
            sourceLastUpdate: new Date().toISOString()
          }
        }, {
          date: data.auditDate || new Date()
        }, client)
      } catch (e) {
        if (e.name === 'InvalidRequestApiError') {
          errors.push([count, e.message])
          continue
        }
        // noinspection ExceptionCaughtLocallyJS
        throw e
      }
    }
  } catch (error) {
    await client.query('ROLLBACK;')
    await client.release()

    if (error.message.startsWith('Invalid JSON')) {
      throw new InvalidRequestApiError('Le fichier JSON est invalide.')
    }

    throw error
  }

  if (errors.length) {
    await client.query('ROLLBACK;')
  } else {
    await client.query('COMMIT;')
  }
  await client.release()
  return { count, errors }
}

module.exports = {
  addRecordFeature,
  deleteSingleFeature,
  createOrUpdateOperatorRecord,
  fetchLatestCustomersByControlBody,
  getOperatorByNumeroBio,
  getDataGouvStats: memo(getDataGouvStats, { maxAge: 6 * ONE_HOUR }),
  getParcellesStats: memo(getParcellesStats, { maxAge: 6 * ONE_HOUR }),
  getRecord,
  deleteRecord,
  pacageLookup,
  patchFeatureCollection,
  updateAuditRecordState,
  updateFeature,
  parseAPIParcellaireStream,
  parcellaireStreamToDb
}
