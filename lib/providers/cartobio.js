'use strict'

const { featureCollection, polygon, feature } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const memo = require('p-memoize')
// @ts-ignore
const { get } = require('got')
const JSONStream = require('jsonstream-next')

const pool = require('../db.js')
const config = require('../config.js')
const { parsePacDetailsFromComment, fetchOperatorByNumeroBio } = require('./agence-bio.js')
const { populateWithRecords } = require('../outputs/operator.js')
const { normalizeRecord, EtatProduction, CertificationState, normalizeEtatProduction } = require('../outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { EventType, createNewEvent } = require('../outputs/history.js')
const { NotFoundApiError } = require('../errors.js')
const { InvalidRequestApiError } = require('../errors')
const { getRandomFeatureId, populateWithMultipleCultures } = require('../outputs/features')

const ONE_HOUR = 60 * 60 * 1000

/**
 * @typedef {import('geojson').Polygon} Polygon
 * @typedef {import('./types/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('./types/cartobio').DBOperatorRecord} DBOperatorRecord
 * @typedef {import('./types/cartobio').DBOperatorRecordWithParcelles} DBOperatorRecordWithParcelles
 * @typedef {import('./types/cartobio').DBParcelle} DBParcelle
 * @typedef {import('./types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('../outputs/types/api').InputApiRecord} InputApiRecord
 * @typedef {import('../outputs/types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('../outputs/types/features').CartoBioFeatureProperties} CartoBioFeatureProperties
 * @typedef {import('../outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('../outputs/types/history').HistoryEntry} HistoryEntry
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */

/* eslint-disable-next-line quotes */
const recordFields = /* sqlFragment */`record_id, numerobio, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, metadata, audit_history, audit_notes, audit_demandes`

/**
 * Create a new record unless we find a dangling one with the same numeroBio, in which case we update it
 * with the merge algorithm described in ../../docs/rfc/001-api-parcellaire.md
 *
 * @param {Object} data
 * @param {String} data.numeroBio
 * @param {Number} data.ocId
 * @param {String} data.ocLabel
 * @param {Object} [data.metadata]
 * @param {import('geojson').FeatureCollection<Polygon|null, CartoBioFeatureProperties>} data.geojson
 * @param {String} [data.certificationState]
 * @param {Object} [context]
 * @param {CartoBioUser} [context.user]
 * @param {NormalizedRecord} [context.oldRecord]
 * @param {Date} [context.date]
 * @param {import('pg').PoolClient} [customClient]
 * @returns {Promise<DBOperatorRecord>}
 */
async function createOrUpdateOperatorRecord (data, context, customClient) {
  const { user, oldRecord } = context || {}
  const { numeroBio, ocId, ocLabel, metadata, geojson } = data

  const certificationState = data.certificationState || CertificationState.OPERATOR_DRAFT

  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_CREATE,
    { features: geojson.features, state: certificationState, metadata, date: context.date },
    { user, record: oldRecord }
  )

  let result = null

  const client = customClient || await pool.connect()

  // Begin transaction
  await client.query('BEGIN;')

  try {
    result = await client.query(
      /* sql */`
        INSERT INTO cartobio_operators
        (numerobio, oc_id, oc_label, created_at, metadata, certification_state, audit_history)
        VALUES ($1, $2, $3, $4, $5, $6, jsonb_build_array($7::jsonb))
        ON CONFLICT (numerobio)
            DO UPDATE
            SET (oc_id, oc_label, updated_at, metadata, certification_state, audit_history)
                    = ($2, $3, $4, $5, $6, (cartobio_operators.audit_history || coalesce($7, '[]')::jsonb))
        RETURNING ${recordFields}`,
      // changing the arity will impact server.test.js tests
      [numeroBio, ocId, ocLabel, 'now', metadata, certificationState, historyEntry]
    )

    const parcelles = []
    for (let feature of geojson.features) {
      feature = populateWithMultipleCultures(feature)
      const { rows } = await client.query(
        /* sql */`
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire,
           annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
           reference_cadastre)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10, $11, $12, $13, $14)
          ON CONFLICT (record_id, id)
              DO UPDATE
              SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire,
                   annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
                   reference_cadastre) =
                      (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                       coalesce($5, cartobio_parcelles.cultures), coalesce($6, cartobio_parcelles.conversion_niveau),
                       coalesce($7, cartobio_parcelles.engagement_date), coalesce($8, cartobio_parcelles.commentaire),
                       coalesce($9, cartobio_parcelles.annotations), now(), coalesce($10, cartobio_parcelles.name),
                       coalesce($11, cartobio_parcelles.numero_pacage), coalesce($12, cartobio_parcelles.numero_ilot_pac),
                       coalesce($13, cartobio_parcelles.numero_parcelle_pac),
                       coalesce($14, cartobio_parcelles.reference_cadastre))
          RETURNING *, ST_AsGeoJSON(geometry)::json as geometry`,
        [
          result.rows.at(0).record_id,
          feature.id || getRandomFeatureId(),
          feature.geometry,
          feature.properties.COMMUNE,
          JSON.stringify(feature.properties.cultures ?? []),
          feature.properties.conversion_niveau,
          feature.properties.engagement_date,
          feature.properties.commentaire,
          JSON.stringify(feature.properties.annotations ?? []),
          feature.properties.NOM,
          feature.properties.PACAGE,
          feature.properties.NUMERO_I,
          feature.properties.NUMERO_P,
          feature.properties.cadastre
        ]
      )
      parcelles.push(rows.at(0))
    }
    await client.query(
      /* sql */`
        DELETE
        FROM cartobio_parcelles
        WHERE record_id = $1 AND id != ALL($2)`,
      [result.rows.at(0).record_id, parcelles.map(({ id }) => id)]
    )
    await client.query('COMMIT;')
    return { ...result.rows.at(0), parcelles }
  } catch (e) {
    await client.query('ROLLBACK;')
    if (e.code === '23502') {
      throw new InvalidRequestApiError('La donnée géographique est manquante ou invalide.')
    }

    throw e
  } finally {
    if (!customClient) {
      client.release()
    }
  }
}

/**
 * @param {Object} recordInfo
 * @param {CartoBioUser} recordInfo.user
 * @param {NormalizedRecord} recordInfo.record
 * @param {Partial<CartoBioFeature>[]} features
 * @returns {Promise<DBOperatorRecord>}
 */
async function patchFeatureCollection ({ user, record }, features) {
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_UPDATE,
    { features },
    { user, record }
  )

  // Begin transaction
  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    const { rows: updatedRows } = await client.query(
      /* sql */`
        UPDATE cartobio_operators
        SET updated_at    = now(),
            audit_history = (audit_history || coalesce($2, '[]')::jsonb)
        WHERE record_id = $1
        RETURNING ${recordFields}`,
      [record.record_id, historyEntry])

    for (const feature of features) {
      const sqlArgs = [
        record.record_id,
        feature.id || getRandomFeatureId(),
        feature.geometry,
        feature.properties.COMMUNE,
        JSON.stringify(feature.properties.cultures ?? []),
        feature.properties.conversion_niveau,
        feature.properties.engagement_date,
        feature.properties.commentaire,
        JSON.stringify(feature.properties.annotations ?? []),
        feature.properties.NOM,
        feature.properties.PACAGE,
        feature.properties.NUMERO_I,
        feature.properties.NUMERO_P,
        feature.properties.cadastre
      ]
      const { rows } = await client.query(
        /* sql */`
          UPDATE cartobio_parcelles
          SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire,
               annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
               reference_cadastre) =
                  (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                   coalesce($5, cartobio_parcelles.cultures),
                   coalesce($6, cartobio_parcelles.conversion_niveau),
                   coalesce($7, cartobio_parcelles.engagement_date),
                   coalesce($8, cartobio_parcelles.commentaire),
                   coalesce($9, cartobio_parcelles.annotations), now(), coalesce($10, cartobio_parcelles.name),
                   coalesce($11, cartobio_parcelles.numero_pacage),
                   coalesce($12, cartobio_parcelles.numero_ilot_pac),
                   coalesce($13, cartobio_parcelles.numero_parcelle_pac),
                   coalesce($14, cartobio_parcelles.reference_cadastre))
          WHERE record_id = $1
            AND id = $2
          RETURNING record_id, id`,
        sqlArgs
      )

      if (!rows.length) {
        await client.query(
          /* sql */`
            INSERT INTO cartobio_parcelles
            (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire,
             annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
             reference_cadastre)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10, $11, $12, $13, $14)`,
          sqlArgs
        )
      }
    }
    await client.query('COMMIT;')
    return joinRecordParcelles(updatedRows.at(0))
  } catch (error) {
    await client.query('ROLLBACK;')
    throw error
  } finally {
    client.release()
  }
}

/**
 * @param {Object} featureInfo
 * @param {Number} featureInfo.featureId
 * @param {CartoBioUser} featureInfo.user
 * @param {NormalizedRecord} featureInfo.record
 * @param {Object} featureData
 * @param {CartoBioFeatureProperties} featureData.properties
 * @param {Polygon} featureData.geometry
 * @returns {Promise<DBOperatorRecord>}
 */
async function updateFeature ({ featureId, user, record }, { properties, geometry }) {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === String(featureId))

  if (!matchingFeature) {
    throw new NotFoundApiError('Parcelle introuvable')
  }

  const historyEntry = createNewEvent(
    EventType.FEATURE_UPDATE,
    { features: [matchingFeature] },
    { user, record }
  )

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    const { rows: updatedRows } = await client.query(
      /* sql */`
                UPDATE cartobio_operators
                SET updated_at = now(),
                    audit_history = (audit_history || coalesce($2, '[]')::jsonb)
                WHERE record_id = $1
                RETURNING ${recordFields}`,
      [
        record.record_id,
        historyEntry
      ]
    )

    // Update parcelle
    await client.query(
      /* sql */`
        UPDATE cartobio_parcelles
        SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire,
             annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
             reference_cadastre) =
                (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                 coalesce($5, cartobio_parcelles.cultures), coalesce($6, cartobio_parcelles.conversion_niveau),
                 coalesce($7, cartobio_parcelles.engagement_date), coalesce($8, cartobio_parcelles.commentaire),
                 coalesce($9, cartobio_parcelles.annotations), now(), coalesce($10, cartobio_parcelles.name),
                 coalesce($11, cartobio_parcelles.numero_pacage),
                 coalesce($12, cartobio_parcelles.numero_ilot_pac),
                 coalesce($13, cartobio_parcelles.numero_parcelle_pac),
                 coalesce($14, cartobio_parcelles.reference_cadastre))
        WHERE record_id = $1 AND id = $2`,
      [
        record.record_id,
        featureId,
        geometry,
        properties.COMMUNE,
        JSON.stringify(properties.cultures),
        properties.conversion_niveau,
        properties.engagement_date,
        properties.commentaire,
        JSON.stringify(properties.annotations),
        properties.NOM,
        properties.PACAGE,
        properties.NUMERO_I,
        properties.NUMERO_P,
        properties.cadastre
      ])

    await client.query('COMMIT;')
    return joinRecordParcelles(updatedRows.at(0))
  } catch (error) {
    await client.query('ROLLBACK;')
    throw error
  } finally {
    client.release()
  }
}

/**
 * @param {Object} updated
 * @param {Number} updated.featureId
 * @param {CartoBioUser} updated.user
 * @param {NormalizedRecord} updated.record
 * @param {Object} context
 * @param {{code: String, details: String?}} context.reason
 * @returns {Promise<DBOperatorRecord>}
 */
async function deleteSingleFeature ({ featureId, user, record }, { reason }) {
  const matchingFeature = record.parcelles.features.find(({ id }) => id === String(featureId))

  if (!matchingFeature) {
    throw new NotFoundApiError('Parcelle introuvable')
  }

  const historyEntry = createNewEvent(
    EventType.FEATURE_DELETE,
    { features: [matchingFeature], metadata: { reason, feature: matchingFeature } },
    { user, record }
  )

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    // Remove parcelle
    await client.query(
      /* sql */`
        DELETE FROM cartobio_parcelles
        WHERE record_id = $1 AND id = $2`, [record.record_id, featureId]
    )

    // Add history entry
    const { rows: updatedRows } = await client.query(
      /* sql */`
        UPDATE cartobio_operators
        SET updated_at = now(), audit_history = (audit_history || coalesce($2, '[]')::jsonb)
        WHERE record_id = $1
        RETURNING ${recordFields}`,
      [record.record_id, historyEntry]
    )

    await client.query('COMMIT;')
    return joinRecordParcelles(updatedRows.at(0))
  } catch (error) {
    await client.query('ROLLBACK;')
    throw error
  } finally {
    client.release()
  }
}

/**
 * @param {Object} recordInfo
 * @param {CartoBioUser} recordInfo.user
 * @param {NormalizedRecord} recordInfo.record
 * @param {CartoBioFeature} feature
 * @returns {Promise<DBOperatorRecord>}
 */
async function addRecordFeature ({ user, record }, feature) {
  const newId = Date.now()

  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_CREATE,
    { features: [feature], description: `Parcelle ${feature.properties.cadastre} ajoutée` },
    { user, record }
  )

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    // Add parcelle
    await client.query(
      /* sql */`
        INSERT INTO cartobio_parcelles
        (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire,
         annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
         reference_cadastre)
        VALUES ($1, $2, $3, $4, coalesce($5, '[]')::jsonb, $6, $7, $8, coalesce($9, '[]')::jsonb, now(), now(),
                $10, $11, $12, $13, $14)`,
      [
        record.record_id,
        newId,
        feature.geometry,
        feature.properties.COMMUNE,
        JSON.stringify(feature.properties.cultures ?? []),
        feature.properties.conversion_niveau,
        feature.properties.engagement_date,
        feature.properties.commentaire,
        JSON.stringify(feature.properties.annotations ?? []),
        feature.properties.NOM,
        feature.properties.PACAGE,
        feature.properties.NUMERO_I,
        feature.properties.NUMERO_P,
        feature.properties.cadastre
      ]
    )

    // Add history entry
    const { rows: updatedRows } = await client.query(
      /* sql */`
        UPDATE cartobio_operators
        SET updated_at    = now(),
            audit_history = (audit_history || coalesce($2, '[]')::jsonb)
        WHERE record_id = $1
        RETURNING ${recordFields}`,
      [
        record.record_id,
        historyEntry
      ]
    )

    await client.query('COMMIT;')
    return joinRecordParcelles(updatedRows.at(0))
  } catch (error) {
    await client.query('ROLLBACK;')
    throw error
  } finally {
    client.release()
  }
}

/**
 * @param {String} numeroBio
 * @return {Promise<NormalizedRecord>}
 */
async function getOperatorByNumeroBio (numeroBio) {
  const [result, operator] = await Promise.allSettled([
    pool.query(`SELECT ${recordFields} FROM cartobio_operators WHERE numerobio = $1 LIMIT 1`, [numeroBio]),
    fetchOperatorByNumeroBio(numeroBio)
  ])

  // @ts-ignore
  const [record] = result.value.rows

  if (!record && operator.status === 'rejected') {
    return null
  }

  // @ts-ignore
  return normalizeRecord({ record: await joinRecordParcelles(record), operator: operator.value })
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

  return normalizeRecord({ record: await joinRecordParcelles(record), operator })
}

/**
 * @param {{user: CartoBioUser, record: NormalizedRecord}} recordInfo
 * @return {Promise<DBOperatorRecord>}
 */
async function deleteRecord ({ user, record }) {
  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_DELETE,
    { },
    { user, record }
  )

  // Begin transaction
  const client = await pool.connect()
  await client.query('BEGIN;')
  try {
    const result = await client.query(
      /* sql */`
        UPDATE cartobio_operators
        SET updated_at               = now(),
            certification_date_debut = NULL,
            certification_date_fin   = NULL,
            certification_state      = NULL,
            audit_notes              = '',
            metadata                 = '{}'::jsonb,
            audit_history            = (audit_history || coalesce($2, '[]')::jsonb)
        WHERE record_id = $1
        RETURNING ${recordFields}`,
      [record.record_id, historyEntry]
    )
    // Delete parcelles for this record
    await client.query(
      /* sql */`
        DELETE FROM cartobio_parcelles WHERE record_id = $1`,
      [record.record_id]
    )
    await client.query('COMMIT;')

    return result.rows.at(0)
  } catch (error) {
    await client.query('ROLLBACK;')
    throw error
  } finally {
    client.release()
  }
}

/**
 * @param {{numeroPacage: String}} params
 * @return {Promise<CartoBioFeature>}
 */
async function pacageLookup ({ numeroPacage }) {
  const { rows } = await pool.query(
    /* SQL */`
      SELECT ST_AsGeoJSON(geom, 15)::json AS geometry,
             num_ilot as "NUMERO_I",
             num_parcel as "NUMERO_P",
             bio as "BIO",
             code_cultu AS "TYPE",
             fid
      FROM rpg_bio
      WHERE pacage = $1`,
    [numeroPacage]
  )
  return toWgs84({
    type: 'FeatureCollection',
    features: rows.map(({ geometry, fid: id, NUMERO_I, NUMERO_P, TYPE, BIO }) => ({
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
 * @param {{ocId: Number}} params
 * @return {Promise<AgenceBioNormalizedOperatorWithRecord[]>}
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
    // @ts-ignore
    .then(responses => responses.map(({ value }) => value))
    .then(operators => operators.filter(d => d))
    .then(operators => populateWithRecords(operators))
}

/**
 * @param {Object} recordInfo
 * @param {CartoBioUser} recordInfo.user
 * @param {NormalizedRecord} recordInfo.record
 * @param {Object} patch
 * @param {String} patch.auditeur_notes
 * @param {String} patch.audit_notes
 * @param {String} patch.audit_demandes
 * @param {String} patch.certification_state
 * @param {String} patch.certification_date_debut
 * @param {String} patch.certification_date_fin
 * @param {Array} patch.cultures
 * @param {String} patch.conversion_niveau
 * @param {String} patch.engagement_date
 * @return {Promise<DBOperatorRecordWithParcelles>}
 */
async function updateAuditRecordState ({ user, record }, patch) {
  const { certification_state: state } = patch
  const columns = ['updated_at']
  const placeholders = ['$2']
  /**
   * @type {*[]}
   */
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
      { user, record }
    ))
  }

  const { rows } = await pool.query(/* sql */`UPDATE cartobio_operators
    SET (${columns.join(', ')}) = (${placeholders.join(', ')})
    WHERE record_id = $1
    RETURNING ${recordFields}`,
  [record.record_id, ...values])

  return joinRecordParcelles(rows.at(0))
}

/**
 *
 * @param {DBOperatorRecord=} record
 * @return {Promise<DBOperatorRecordWithParcelles>}
 */
async function joinRecordParcelles (record) {
  if (record && !record.parcelles) {
    const { rows } = await pool.query(
      /* sql */`
        SELECT *, ST_AsGeoJSON(geometry)::json as geometry
        FROM cartobio_parcelles
        WHERE record_id = $1`,
      [record.record_id]
    )

    return { ...record, parcelles: rows }
  }

  return { ...record, parcelles: record?.parcelles ?? [] }
}

/**
 * @returns {Promise.<{count: Number, parcelles_count: Number}>} result
 */
async function getParcellesStats () {
  const { rows } = await pool.query(
    /* sql */`
      SELECT COUNT(cartobio_parcelles.*)
      FROM cartobio_operators
               JOIN cartobio_parcelles ON cartobio_operators.record_id = cartobio_parcelles.record_id
      WHERE cartobio_operators.metadata ->> 'source' != '';`
  )

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
 * @generator
 * @param {NodeJS.ReadableStream} stream - a Json Stream
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @yields {{numeroBio: String, data: Object?, error: Error?}}
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  /**
   * @type {Promise<InputApiRecord>[]}
   */
  const streamRecords = stream.pipe(JSONStream.parse([true]))

  for await (const record of streamRecords) {
    if (isNaN(Date.parse(record.dateAudit))) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateAudit incorrect') }
      continue
    }

    let hasFeatureError = null

    const features = record.parcelles
      // turn products into features
      .map(parcelle => {
        const id = !Number.isNaN(parseInt(String(parcelle.id), 10)) ? parseInt(String(parcelle.id), 10) : getRandomFeatureId()
        const cultures = parcelle.culture ?? parcelle.cultures
        const pac = parsePacDetailsFromComment(parcelle.commentaire)
        const numeroIlot = parseInt(String(parcelle.numeroIlot), 10)
        const numeroParcelle = parseInt(String(parcelle.numeroParcelle), 10)

        const properties = {
          id,
          remoteId: parcelle.id,
          CAMPAGNE: record.anneeReferenceControle,
          cultures: cultures.map(({ codeCPF, quantite, variete = '' }) => ({
            id: randomUUID(),
            CPF: codeCPF,
            surface: parseFloat(String(quantite)),
            variete
          })),
          NUMERO_I: Number.isNaN(numeroIlot) ? (pac.numeroIlot ?? '') : String(numeroIlot),
          NUMERO_P: Number.isNaN(numeroParcelle) ? (pac.numeroParcelle ?? '') : String(numeroParcelle),
          PACAGE: record.numeroPacage ? String(record.numeroPacage) : '',
          conversion_niveau: normalizeEtatProduction(parcelle.etatProduction),
          engagement_date: parcelle.dateEngagement ?? '',
          auditeur_notes: parcelle.commentaire ?? ''
        }

        let coordinates = []

        if (parcelle.geom === null || parcelle.geom === undefined || parcelle.geom === '' || parcelle.geom === 'null') {
          return feature(null, properties, { id })
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
          return null
        }

        try {
          return polygon(coordinates, properties, { id })
        } catch (error) {
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          return null
        }
      })

    // known error, we skip the record
    if (hasFeatureError) {
      yield { numeroBio: String(record.numeroBio), error: hasFeatureError }
      continue
    }

    // emit a data structure similar to what `/v2/operator/${numeroBio}/parcelles` consumes
    yield {
      numeroBio: String(record.numeroBio),
      data: {
        ocId: organismeCertificateur.id,
        ocLabel: organismeCertificateur.nom,
        numeroPacage: String(record.numeroPacage),
        auditDate: new Date(record.dateAudit),
        geojson: featureCollection(features)
      }
    }
  }
}

/**
 * @param {NodeJS.ReadableStream} stream
 * @param {OrganismeCertificateur} organismeCertificateur
 * @returns {Promise<{count: number, errors: Array<[Number, String]>}>}
 */
async function parcellaireStreamToDb (stream, organismeCertificateur) {
  const generator = parseAPIParcellaireStream(stream, { organismeCertificateur })
  let count = 0
  /** @type {Array<[Number, String]>} */
  const errors = []

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    for await (const { numeroBio, data, error } of generator) {
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
    client.release()

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
  client.release()
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
