'use strict'

const { feature, featureCollection, polygon } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const memo = require('p-memoize')
// @ts-ignore
const { extend, get, HTTPError } = require('got')
const { escapeLiteral } = require('pg')
const JSONStream = require('jsonstream-next')
const { XMLParser } = require('fast-xml-parser')
const { SocksProxyAgent } = require('socks-proxy-agent')

const pool = require('../db.js')
const config = require('../config.js')
const { EtatProduction, CertificationState, EventType } = require('../enums')
const { parsePacDetailsFromComment, fetchOperatorByNumeroBio, fetchCustomersByOc } = require('./agence-bio.js')
const { populateWithRecords } = require('../outputs/operator.js')
const { normalizeRecord, normalizeRecordSummary, normalizeEtatProduction } = require('../outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { fromCepageCode } = require('@agencebio/rosetta-cultures/cepages')
const { createNewEvent } = require('../outputs/history.js')
const { InvalidRequestApiError, BadGatewayApiError, NotFoundApiError } = require('../errors.js')
const { getRandomFeatureId, populateWithMultipleCultures } = require('../outputs/features.js')
const Cursor = require('pg-cursor')

const ONE_HOUR = 60 * 60 * 1000

/**
 * Douanes HTTP client has two use cases:
 * - prod/preprod : the baseUrl DNS is staticly configured/resolved
 * - local dev: the baseUrl DNS is accessible through a SOCKS proxy
 *
 * @see README for the SSH proxy configuration instructions
 */
const evvClient = extend({
  http2: false,
  https: {
    rejectUnauthorized: false
  },
  timeout: {
    lookup: 200,
    connect: 500
  },
  ...(config.get('douanes.socksProxy')
    ? {
        agent: {
          http: new SocksProxyAgent(config.get('douanes.socksProxy')),
          https: new SocksProxyAgent(config.get('douanes.socksProxy'))
        }
      }
    : {}
  ),
  prefixUrl: config.get('douanes.baseUrl')
})

/**
 * @typedef {import('geojson').Feature} Feature
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').GeoJsonProperties} FeatureProperties
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
 * @typedef {import('../outputs/types/record').NormalizedRecordSummary} NormalizedRecordSummary
 * @typedef {import('../outputs/types/history').HistoryEntry} HistoryEntry
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */

/* eslint-disable-next-line quotes */
const recordFields = /* sqlFragment */`cartobio_operators.record_id, numerobio, version_name, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes`

/**
 * Create a new record unless we find a dangling one with the same numeroBio and audit date, in which case we update it
 * with the merge algorithm described in ../../docs/rfc/001-api-parcellaire.md
 *
 * @param {Partial<NormalizedRecord>} record
 * @param {Object} [context]
 * @param {CartoBioUser} [context.user]
 * @param {Boolean} [context.copyParcellesData]
 * @param {String} [context.previousRecordId]
 * @param {import('pg').PoolClient} [customClient]
 * @returns {Promise<DBOperatorRecordWithParcelles>}
 */
async function createOrUpdateOperatorRecord (record, context = {}, customClient) {
  const certificationState = record.certification_state || CertificationState.OPERATOR_DRAFT

  /** @type {HistoryEntry} */
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_CREATE,
    { features: record.parcelles.features, state: certificationState, metadata: record.metadata, date: new Date() },
    { user: context?.user, record: null }
  )

  let result = null
  const client = customClient || await pool.connect()

  // Begin transaction
  await client.query('BEGIN;')

  try {
    result = await client.query(
      /* sql */`
        INSERT INTO cartobio_operators
        (numerobio, oc_id, oc_label, created_at, metadata, certification_state, certification_date_debut, certification_date_fin, audit_history, audit_date, audit_notes, version_name)
        VALUES ($1, $2, $3, $4, $5, $6, nullif($7, '')::date, nullif($8, '')::date, jsonb_build_array($9::jsonb),
                nullif($10, '')::date, $11, COALESCE($12, 'Version créée le ' || to_char(now(), 'DD/MM/YYYY')))
        ON CONFLICT (numerobio, audit_date) WHERE cartobio_operators.deleted_at IS NULL
            DO UPDATE
            SET (oc_id, oc_label, updated_at, metadata, certification_state, certification_date_debut, certification_date_fin, audit_history, audit_notes, version_name)
                    = ($2, $3, $4, $5, coalesce($6, cartobio_operators.certification_state),
                       nullif(coalesce($7, cartobio_operators.certification_date_debut::text), '')::date,
                       nullif(coalesce($8, cartobio_operators.certification_date_fin::text), '')::date,
                       (cartobio_operators.audit_history || coalesce($9, '[]')::jsonb),
                       coalesce($11, cartobio_operators.audit_notes), coalesce($12, cartobio_operators.version_name))
        RETURNING ${recordFields}`,
      [
        /* $1 */ record.numerobio,
        /* $2 */ record.oc_id,
        /* $3 */ record.oc_label,
        /* $4 */ 'now',
        /* $5 */ record.metadata,
        /* $6 */ certificationState,
        /* $7 */ record.certification_date_debut,
        /* $8 */ record.certification_date_fin,
        /* $9 */ historyEntry,
        /* $10 */ record.audit_date,
        /* $11 */ record.audit_notes,
        /* $12 */ record.version_name
      ]
    )

    if (result.rows[0].certification_state === CertificationState.CERTIFIED) {
      if (!result.rows[0].certification_date_debut || !result.rows[0].certification_date_fin) {
        throw new InvalidRequestApiError('Les dates de certification sont manquantes.')
      }
    }

    const parcelles = []
    for (let feature of record.parcelles.features) {
      feature = populateWithMultipleCultures(feature)
      if (!feature.geometry) {
        const { rows: partialUpdateRows } = await client.query(
          /* sql */`
          UPDATE cartobio_parcelles
              SET (commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
              annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
              reference_cadastre) =
              (coalesce($3, cartobio_parcelles.commune), coalesce($4, cartobio_parcelles.cultures),
               coalesce($5, cartobio_parcelles.conversion_niveau),
               nullif(coalesce($6::text, cartobio_parcelles.engagement_date::text), '')::date,
               coalesce($7, cartobio_parcelles.commentaire), coalesce($8, cartobio_parcelles.auditeur_notes),
               coalesce($9, cartobio_parcelles.annotations), now(), coalesce($10, cartobio_parcelles.name),
               coalesce($11, cartobio_parcelles.numero_pacage), coalesce($12, cartobio_parcelles.numero_ilot_pac),
               coalesce($13, cartobio_parcelles.numero_parcelle_pac),
               coalesce($14, cartobio_parcelles.reference_cadastre))
          WHERE record_id = $1 AND id = $2
          RETURNING *, ST_AsGeoJSON(geometry)::json as geometry`,
          [
            /*  $1 */ result.rows.at(0).record_id,
            /*  $2 */ feature.id || getRandomFeatureId(),
            /*  $3 */ feature.properties.COMMUNE,
            /*  $4 */ feature.properties.cultures ? JSON.stringify(feature.properties.cultures) : null,
            /*  $5 */ feature.properties.conversion_niveau,
            /*  $6 */ feature.properties.engagement_date,
            /*  $7 */ feature.properties.commentaires,
            /*  $8 */ feature.properties.auditeur_notes,
            /*  $9 */ feature.properties.annotations ? JSON.stringify(feature.properties.annotations) : null,
            /* $10 */ feature.properties.NOM,
            /* $11 */ feature.properties.PACAGE,
            /* $12 */ feature.properties.NUMERO_I,
            /* $13 */ feature.properties.NUMERO_P,
            /* $14 */ feature.properties.cadastre
          ]
        )

        if (!partialUpdateRows.length) {
          throw new InvalidRequestApiError('Impossible de créer une parcelle sans donnée géographique.')
        }

        parcelles.push(partialUpdateRows.at(0))
        continue
      }

      const { rows } = await client.query(
        /* sql */`
          WITH previous_version AS (
              SELECT conversion_niveau, engagement_date, auditeur_notes, name, cultures
              FROM cartobio_operators
                  LEFT JOIN cartobio_parcelles ON cartobio_operators.record_id = cartobio_parcelles.record_id
              WHERE numerobio = $16
                AND ST_Equals(
                    ST_ReducePrecision(ST_MakeValid(geometry), 0.00001),
                    ST_ReducePrecision(ST_MakeValid(ST_SetSRID($3::geometry, 4326)), 0.00001)
                )
                AND cartobio_operators.record_id = $18
                AND cartobio_operators.deleted_at IS NULL
                AND $17
              ORDER BY created_at DESC
              LIMIT 1
          ),
          previous_variete AS (
              SELECT new_cultures->>'CPF' AS CPF, string_agg(DISTINCT(old_cultures->>'variete'), '; ') AS varietes
              FROM previous_version, jsonb_array_elements($5::jsonb) AS new_cultures
              JOIN jsonb_array_elements(previous_version.cultures) AS old_cultures
                  ON (new_cultures->>'CPF') = (old_cultures->>'CPF')
              WHERE $17
              GROUP BY new_cultures->>'CPF'
          ),
          merged_cultures AS (
              SELECT jsonb_agg((SELECT new_cultures || jsonb_build_object('variete', coalesce(new_cultures->>'variete', previous_variete.varietes, '')))) AS cultures
              FROM jsonb_array_elements($5::jsonb) AS new_cultures
              LEFT JOIN previous_variete ON previous_variete.CPF = new_cultures->>'CPF'
              WHERE $17
            )
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
           annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
           reference_cadastre)
          VALUES ($1, $2, $3, $4, coalesce((SELECT cultures FROM merged_cultures), $5, '[]'::jsonb),
                  coalesce(NULLIF($6, 'AB?'), (SELECT conversion_niveau FROM previous_version), $6),
                  nullif(coalesce($7::text, (SELECT engagement_date FROM previous_version)::text), '')::date, $8,
                  coalesce($9,(SELECT auditeur_notes FROM previous_version)),
                  coalesce($10, '[]'::jsonb),
                  now(), now(), coalesce(NULLIF($11, ''), (SELECT name FROM previous_version)), $12, $13, $14, $15)
          ON CONFLICT (record_id, id)
              DO UPDATE
              SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
                   annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
                   reference_cadastre) =
                      (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                       coalesce($5, cartobio_parcelles.cultures), coalesce($6, cartobio_parcelles.conversion_niveau),
                       nullif(coalesce($7::text, cartobio_parcelles.engagement_date::text), '')::date,
                       coalesce($8, cartobio_parcelles.commentaire),
                       coalesce($9, cartobio_parcelles.auditeur_notes), coalesce($10, cartobio_parcelles.annotations),
                       now(), coalesce($11, cartobio_parcelles.name), coalesce($12, cartobio_parcelles.numero_pacage),
                       coalesce($13, cartobio_parcelles.numero_ilot_pac), coalesce($14, cartobio_parcelles.numero_parcelle_pac),
                       coalesce($15, cartobio_parcelles.reference_cadastre))
          RETURNING *, ST_AsGeoJSON(geometry)::json as geometry`,
        [
          /*  $1 */ result.rows.at(0).record_id,
          /*  $2 */ feature.id || getRandomFeatureId(),
          /*  $3 */ feature.geometry,
          /*  $4 */ feature.properties.COMMUNE,
          /*  $5 */ feature.properties.cultures ? JSON.stringify(feature.properties.cultures) : null,
          /*  $6 */ feature.properties.conversion_niveau,
          /*  $7 */ feature.properties.engagement_date,
          /*  $8 */ feature.properties.commentaires,
          /*  $9 */ feature.properties.auditeur_notes,
          /* $10 */ feature.properties.annotations ? JSON.stringify(feature.properties.annotations) : null,
          /* $11 */ feature.properties.NOM,
          /* $12 */ feature.properties.PACAGE,
          /* $13 */ feature.properties.NUMERO_I,
          /* $14 */ feature.properties.NUMERO_P,
          /* $15 */ feature.properties.cadastre,
          /* $16 */ result.rows.at(0).numerobio,
          /* $17 */ Boolean(context?.copyParcellesData),
          /* $18 */ context?.previousRecordId || randomUUID()
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

    if (context?.copyParcellesData && context?.previousRecordId) {
      const addedParcelles = await client.query(
        /* sql */`
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, auditeur_notes,
            name, reference_cadastre)
          (
                SELECT $1, id, geometry, commune, cultures, conversion_niveau, engagement_date, auditeur_notes,
                    name, reference_cadastre
                FROM cartobio_operators co
                CROSS JOIN jsonb_to_recordset(co.audit_history)
                    AS x("featureIds" text, type text, state text, date text)
                LEFT JOIN cartobio_parcelles ON co.record_id = cartobio_parcelles.record_id    
                WHERE
                    type = 'FeatureCollectionCreation'
                    AND state = 'OPERATOR_DRAFT'
                    AND NOT "featureIds" ~ id
                    AND co.record_id = (
                        SELECT record_id
                        FROM cartobio_operators
                        WHERE numerobio = $2
                          AND cartobio_operators.record_id = $1
                          AND cartobio_operators.deleted_at IS NULL
                        ORDER BY created_at DESC
                        LIMIT 1
                    )
                ORDER BY date DESC
          )
          ON CONFLICT (record_id, id) DO NOTHING
          RETURNING *, ST_AsGeoJSON(geometry)::json as geometry
        `,
        [context.previousRecordId, result.rows.at(0).numerobio]
      )
      parcelles.push(...addedParcelles.rows)
    }

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
 * @param numeroBio
 * @return {Promise<NormalizedRecordSummary[]>}
 */
async function getRecords (numeroBio) {
  const { rows } = await pool.query(
    /* sql */`
    SELECT ${recordFields}, COUNT(cp.id) as parcelles, SUM(ST_Area(to_legal_projection(cp.geometry))) as surface
    FROM cartobio_operators
    LEFT JOIN public.cartobio_parcelles cp on cartobio_operators.record_id = cp.record_id
    WHERE numerobio = $1 AND deleted_at IS NULL
    GROUP BY ${recordFields}
    ORDER BY EXTRACT(year from COALESCE(certification_date_debut, audit_date, created_at)) DESC`,
    [numeroBio]
  )

  return rows.map(normalizeRecordSummary)
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
      await client.query(
        /* sql */`
          UPDATE cartobio_parcelles
          SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
               annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
               reference_cadastre) =
                  (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                   coalesce($5, cartobio_parcelles.cultures),
                   coalesce($6, cartobio_parcelles.conversion_niveau),
                   nullif(coalesce($7::text, cartobio_parcelles.engagement_date::text), '')::date,
                   coalesce($8, cartobio_parcelles.commentaire),
                   coalesce($9, cartobio_parcelles.auditeur_notes),
                   coalesce($10, cartobio_parcelles.annotations), now(), coalesce($11, cartobio_parcelles.name),
                   coalesce($12, cartobio_parcelles.numero_pacage),
                   coalesce($13, cartobio_parcelles.numero_ilot_pac),
                   coalesce($14, cartobio_parcelles.numero_parcelle_pac),
                   coalesce($15, cartobio_parcelles.reference_cadastre))
          WHERE record_id = $1
            AND id = $2
          RETURNING record_id, id`,
        [
          /* $1 */ record.record_id,
          /* $2 */ feature.id || getRandomFeatureId(),
          /* $3 */ feature.geometry,
          /* $4 */ feature.properties.COMMUNE,
          /* $5 */ feature.properties.cultures ? JSON.stringify(feature.properties.cultures) : null,
          /* $6 */ feature.properties.conversion_niveau,
          /* $7 */ feature.properties.engagement_date,
          /* $8 */ feature.properties.commentaires,
          /* $9 */ feature.properties.auditeur_notes,
          /* $10 */ feature.properties.annotations ? JSON.stringify(feature.properties.annotations) : null,
          /* $11 */ feature.properties.NOM,
          /* $12 */ feature.properties.PACAGE,
          /* $13 */ feature.properties.NUMERO_I,
          /* $14 */ feature.properties.NUMERO_P,
          /* $15 */ feature.properties.cadastre
        ]
      )
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
        SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
             annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
             reference_cadastre) =
                (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                 coalesce($5, cartobio_parcelles.cultures), coalesce($6, cartobio_parcelles.conversion_niveau),
                 nullif(coalesce($7::text, cartobio_parcelles.engagement_date::text), '')::date, coalesce($8, cartobio_parcelles.commentaire),
                 coalesce($9, cartobio_parcelles.auditeur_notes),
                 coalesce($10, cartobio_parcelles.annotations), now(), coalesce($11, cartobio_parcelles.name),
                 coalesce($12, cartobio_parcelles.numero_pacage),
                 coalesce($13, cartobio_parcelles.numero_ilot_pac),
                 coalesce($14, cartobio_parcelles.numero_parcelle_pac),
                 coalesce($15, cartobio_parcelles.reference_cadastre))
        WHERE record_id = $1 AND id = $2`,
      [
        record.record_id,
        featureId,
        geometry,
        properties.COMMUNE,
        properties.cultures ? JSON.stringify(properties.cultures) : null,
        properties.conversion_niveau,
        properties.engagement_date,
        properties.commentaires,
        properties.auditeur_notes,
        properties.annotations ? JSON.stringify(properties.annotations) : null,
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
        (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
         annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
         reference_cadastre)
        VALUES ($1, $2, $3, $4, coalesce($5, '[]')::jsonb, $6, $7, $8, $9, coalesce($10, '[]')::jsonb, now(), now(),
                $11, $12, $13, $14, $15)`,
      [
        record.record_id,
        newId,
        feature.geometry,
        feature.properties.COMMUNE,
        JSON.stringify(feature.properties.cultures ?? []),
        feature.properties.conversion_niveau,
        feature.properties.engagement_date,
        feature.properties.commentaires,
        feature.properties.auditeur_notes,
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
 * Returns operator most recently modified record
 *
 * @param {String} numeroBio
 * @param {Object} [filters]
 * @param {String} [filters.anneeAudit]
 * @param {String} [filters.statut]
 * @return {Promise<NormalizedRecord>}
 */
async function getOperatorLastRecord (numeroBio, { anneeAudit = null, statut = null } = {}) {
  const conditions = []
  if (anneeAudit) {
    conditions.push(`EXTRACT('year' FROM audit_date) = $${conditions.length + 2}`)
  }
  if (statut) {
    conditions.push(`certification_state = $${conditions.length + 2}`)
  }
  const result = await pool.query(/* sql */`
    SELECT ${recordFields}
    FROM cartobio_operators
    WHERE
      numerobio = $1 AND deleted_at IS NULL 
      ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
    ORDER BY updated_at DESC
    LIMIT 1`,
  [
    numeroBio,
    ...(anneeAudit ? [anneeAudit] : []),
    ...(statut ? [statut] : [])
  ])
  const record = result.rows.at(0)

  if (!record) {
    throw new NotFoundApiError('Aucun parcellaire trouvé')
  }

  // @ts-ignore
  return normalizeRecord(await joinRecordParcelles(record))
}

/**
 * @param {number} ocId
 * @param anneeAudit
 * @param statut
 * @return {AsyncGenerator<NormalizedRecord, void, *>}
 */
async function * iterateOperatorLastRecords (ocId, { anneeAudit = null, statut = null } = {}) {
  const conditions = []
  if (anneeAudit) {
    conditions.push(`EXTRACT('year' FROM audit_date) = $${conditions.length + 2}`)
  }
  if (statut) {
    conditions.push(`certification_state = $${conditions.length + 2}`)
  }

  const client = await pool.connect()

  try {
    const cursor = client.query(new Cursor(/* sql */`
    SELECT DISTINCT ON (numerobio) ${recordFields}
    FROM cartobio_operators
    WHERE
      oc_id = $1 AND deleted_at IS NULL
      ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
    ORDER BY numerobio ASC, updated_at DESC
  `, [
      ocId,
      ...(anneeAudit ? [anneeAudit] : []),
      ...(statut ? [statut] : [])
    ]))

    for (let rows = await cursor.read(100); rows.length > 0; rows = await cursor.read(100)) {
      for (const row of rows) {
        yield normalizeRecord(await joinRecordParcelles(row))
      }
    }
  } finally {
    client.release()
  }
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

  return normalizeRecord(await joinRecordParcelles(record))
}

/**
 * @param {{user: CartoBioUser, record: NormalizedRecord}} recordInfo
 * @return {Promise<void>}
 */
async function deleteRecord ({ record }) {
  await pool.query(
    /* sql */`
      UPDATE cartobio_operators
      SET deleted_at = now()
      WHERE record_id = $1`,
    [record.record_id]
  )
}

/**
 * We generates a GPKG file with duplicates at the moment.
 * So we explicitely remove them at query time.
 *
 * @param {{numeroPacage: String}} params
 * @return {Promise<CartoBioFeature>}
 */
async function pacageLookup ({ numeroPacage }) {
  const { rows } = await pool.query(
    /* SQL */`
      SELECT DISTINCT ON (pacage, num_ilot, num_parcel)
             ST_AsGeoJSON(geom, 15)::json AS geometry,
             num_ilot as "NUMERO_I",
             num_parcel as "NUMERO_P",
             bio as "BIO",
             code_cultu AS "TYPE",
             precision AS "CODE_VAR",
             fid
      FROM rpg_bio
      WHERE pacage = $1`,
    [numeroPacage]
  )
  return toWgs84({
    type: 'FeatureCollection',
    features: rows.map(({ geometry, fid: id, NUMERO_I, NUMERO_P, TYPE, BIO, CODE_VAR }) => ({
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
            CPF: fromCodePacStrict(TYPE, CODE_VAR)?.code_cpf,
            TYPE
          }
        ],
        NUMERO_I,
        NUMERO_P,
        PACAGE: numeroPacage,
        conversion_niveau: BIO === 1 ? EtatProduction.BIO : EtatProduction.NB
      }
    }))
  }, 'EPSG:3857')
}

/**
 *
 * @param {{ numeroEvv: String }} params
 * @returns {Promise.<{ numero: String, siret: String, libelle: String }>}
 */
async function evvLookup ({ numeroEvv }) {
  try {
    const response = await evvClient.get(`evv/${numeroEvv}`).text()
    const xml = new XMLParser({ parseTagValue: false }).parse(response)

    const { numero, siret, libelle } = xml.evv
    return { numero, siret, libelle }
  } catch (error) {
    if (error instanceof HTTPError && (error?.response?.statusCode === 404 || !Object.hasOwn(error, 'code') /* only for tests */)) {
      return { siret: undefined, numero: numeroEvv, libelle: '' }
    }

    throw new BadGatewayApiError('Impossible de communiquer avec l\'API CVI.', { cause: error })
  }
}

/**
 *
 * @param {{ numeroEvv: String }} params
 * @returns {Promise.<FeatureCollection>}
 */
async function evvParcellaire ({ numeroEvv }) {
  const response = await evvClient.get(`parcellaire/${numeroEvv}`).text()

  const xml = new XMLParser({
    parseTagValue: false,
    isArray: (name, jpath, isLeafNode, isAttribute) => ['pcv', 'spcv'].includes(name) && !isAttribute && !isLeafNode
  }).parse(response)

  if (!Array.isArray(xml.parcellaire.listePcv.pcv)) {
    return featureCollection([])
  }

  return featureCollection(xml.parcellaire.listePcv.pcv.map(p => {
    const id = getRandomFeatureId()
    const properties = {
      id,
      cadastre: [`${p.codeDepartement}${p.codeInseeCommune}${p.prefixe || '000'}${p.section.padStart('2', 0)}${p.plan.padStart(4, '0')}`],
      cultures: (Array.isArray(p.listeSpcv.spcv) ? p.listeSpcv.spcv : [])
        .filter(({ etatGestion }) => etatGestion === 'PL')
        .map(sp => ({
          CPF: fromCepageCode(sp.codeCepage)?.code_cpf ?? '01.21.1',
          variete: fromCepageCode(sp.codeCepage)?.libelle,
          surface: parseFloat(sp.superficieSPCV ?? '0')
        }))
    }

    return feature(null, properties, { id })
  }))
}

const SORT = {
  ASCENDING: 1,
  DESCENDING: -1
}

const STATUS_PRIORITY = {
  UNKNOWN: 0,
  undefined: 0,
  null: 0,
  '': 0,
  // Phase 2
  OPERATOR_DRAFT: 20,
  // Phase 3
  AUDITED: 30,
  // Phase 4
  PENDING_CERTIFICATION: 40,
  // Phase 5
  CERTIFIED: 50
}

const RECORD_SORTS = {
  audit_date: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })
      return function sortByAuditDate (a, b) {
        return collator.compare(a.audit_date ?? '', b.audit_date ?? '') * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql (order) {
      return /* sql */`
        audit_date ${order === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST'}
      `
    }
  },
  engagement_date: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })
      return function sortByEngagementDate (a, b) {
        return collator.compare(a.dateEngagement ?? '', b.dateEngagement ?? '') * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql () {
      // we are not supposed to enter this case
      return 'audit_date DESC NULLS LAST'
    }
  },
  nom: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })
      return function sortByName (a, b) {
        return collator.compare(a.denominationCourante || a.nom || '', b.denominationCourante || b.nom || '') * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql () {
      // we are not supposed to enter this case
      return 'audit_date DESC NULLS LAST'
    }
  },
  statut: {
    fn (order) {
      return function sortByStatut (a, b) {
        return (STATUS_PRIORITY[a.certification_state] - STATUS_PRIORITY[b.certification_state]) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql (order) {
      return /* sql */`
        CASE certification_state
          ${Object.entries(STATUS_PRIORITY).map(([key, value]) => `WHEN ${escapeLiteral(key)} THEN ${value} `).join(' ')}
        END
        ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST,
        audit_date DESC NULLS LAST
      `
    }
  }
}

function recordSorts (type, sort, order) {
  return RECORD_SORTS[sort][type](order)
}

async function searchControlBodyRecords ({ ocId, input, page, sort, order }) {
  const [, siret = '', numeroBio = '', nom = ''] = input.trim().match(/^(\d{14})|(\d+)|(.+)$/) ?? []
  let allNumerobioResults = []
  const PER_PAGE = 25

  // we search by input — all operators comes hydrated from the Agence Bio API
  // all we have then to do is to recoup with record states
  // pagination is software-based
  if (input) {
    const records = await fetchCustomersByOc({ siret, ocId, numeroBio, nom })
      .then(records => records.toSorted(recordSorts('fn', sort, order)))

    const pagination = {
      page,
      total: records.length,
      page_max: Math.max(Math.ceil(records.length / PER_PAGE), 1)
    }

    return {
      pagination,
      records: records.slice((pagination.page - 1) * PER_PAGE, (pagination.page) * PER_PAGE)
    }

  // otherwise we operate on local records first
  // and we hydrate them on a per-record basis (paginating well is important as it has a direct performance impact)
  // pagination is database-based
  } else {
    const { rows } = await pool.query(/* sql */`
      SELECT record_id, numerobio, audit_date, certification_state
      FROM cartobio_operators
      WHERE record_id IN (
        SELECT DISTINCT ON (numerobio) record_id
        FROM cartobio_operators
        WHERE oc_id = $1  AND deleted_at IS NULL
        ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at)::date DESC
      )
      ORDER BY ${recordSorts('psql', sort, order)}`,
    [
      ocId
    ])

    allNumerobioResults = rows.map(({ numerobio }) => numerobio)

    const pagination = {
      page,
      total: allNumerobioResults.length,
      page_max: Math.max(Math.ceil(allNumerobioResults.length / PER_PAGE), 1)
    }

    return Promise.all(
      allNumerobioResults
        .slice((pagination.page - 1) * PER_PAGE, (pagination.page) * PER_PAGE)
        .map(async numerobio => {
          try {
            return await fetchOperatorByNumeroBio(numerobio)
          } catch (error) {
            if (error?.response?.statusCode === 404) return null

            throw error
          }
        })
    )
      .then(operators => populateWithRecords(operators.filter(Boolean)))
      .then(records => ({ pagination, records }))
  }
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

    if (state === CertificationState.AUDITED && !columns.includes('audit_date')) {
      columns.push('audit_date')
      placeholders.push(`$${columns.length + 1}`)
      values.push('NOW()')
    }
  }

  let rows
  try {
    rows = (await pool.query(/* sql */`UPDATE cartobio_operators
      SET (${columns.join(', ')}) = (${placeholders.join(', ')})
      WHERE record_id = $1
      RETURNING ${recordFields}`,
    [record.record_id, ...values])).rows
  } catch (e) {
    if (e.code === '23505') {
      throw new InvalidRequestApiError('Un parcellaire ne peut pas avoir deux versions avec la même date d\'audit.', { cause: e })
    }

    throw e
  }

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
        SELECT
          *,
          ST_AsGeoJSON(geometry)::json as geometry
        FROM cartobio_parcelles
        WHERE record_id = $1
        ORDER BY created ASC`,
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
      SELECT
        COUNT(cartobio_parcelles.*) as parcelles,
        COUNT(DISTINCT cartobio_operators.record_id) as parcellaires,
        SUM(ST_Area(ST_Transform(cartobio_parcelles.geometry, 4326)::geography)/10000) as surface
      FROM cartobio_operators
        JOIN cartobio_parcelles ON cartobio_operators.record_id = cartobio_parcelles.record_id
      WHERE cartobio_operators.certification_state = 'CERTIFIED' AND ST_IsValid(cartobio_parcelles.geometry);`
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
 * @yields {{ record: Partial<NormalizedRecord>, error: Error?}}
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  /**
   * @type {Promise<InputApiRecord>[]}
   */
  const streamRecords = stream.pipe(JSONStream.parse([true]))

  for await (const record of streamRecords) {
    if (record.dateCertificationDebut && isNaN(Date.parse(record.dateCertificationDebut))) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateCertificationDebut incorrect') }
      continue
    }

    if (record.dateCertificationFin && isNaN(Date.parse(record.dateCertificationFin))) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateCertificationFin incorrect') }
      continue
    }

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
        let conversionNiveau
        try {
          conversionNiveau = parcelle.etatProduction && normalizeEtatProduction(parcelle.etatProduction, { strict: true })
        } catch (error) {
          hasFeatureError = new Error('champ etatProduction incorrect')
          return null
        }

        const properties = {
          id,
          cultures: cultures?.map(({ codeCPF, quantite, variete = '', dateSemis = '', unite }) => ({
            id: randomUUID(),
            CPF: codeCPF,
            date_semis: dateSemis,
            surface: parseFloat(String(quantite)),
            unit: unite,
            variete
          })),
          NUMERO_I: Number.isNaN(numeroIlot) ? (pac.numeroIlot ?? '') : String(numeroIlot),
          NUMERO_P: Number.isNaN(numeroParcelle) ? (pac.numeroParcelle ?? '') : String(numeroParcelle),
          PACAGE: record.numeroPacage ? String(record.numeroPacage) : null,
          conversion_niveau: conversionNiveau,
          engagement_date: parcelle.dateEngagement ?? null,
          auditeur_notes: parcelle.commentaire ?? null
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

        if (!Date.parse(parcelle.dateEngagement)) {
          hasFeatureError = new Error('champ dateEngagement incorrect')
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

    if (!Date.parse(record.dateAudit)) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateAudit incorrect') }
      continue
    }

    yield {
      record: {
        numerobio: String(record.numeroBio),
        certification_state: CertificationState.CERTIFIED,
        oc_id: organismeCertificateur.id,
        oc_label: organismeCertificateur.nom,
        parcelles: featureCollection(features),
        audit_notes: record.commentaire,
        certification_date_debut: record.dateCertificationDebut,
        certification_date_fin: record.dateCertificationFin,
        audit_date: (new Date(record.dateAudit)).toISOString(),
        metadata: {
          source: 'API Parcellaire',
          sourceLastUpdate: new Date().toISOString(),
          anneeReferenceControle: record.anneeReferenceControle,
          ...(record.anneeAssolement ? { anneeAssolement: record.anneeAssolement } : {})
        }
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
    for await (const { record, error } of generator) {
      count++
      if (error) {
        errors.push([count, error.message])
        continue
      }

      try {
        await createOrUpdateOperatorRecord(record, null, client)
      } catch (e) {
        if (e.code === 'INVALID_API_REQUEST') {
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

    if (error.message.startsWith('Invalid JSON') || error.message.startsWith('Unexpected ')) {
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
  getRecords,
  getOperatorLastRecord,
  iterateOperatorLastRecords,
  searchControlBodyRecords,
  getDataGouvStats: memo(getDataGouvStats, { maxAge: 6 * ONE_HOUR }),
  getParcellesStats: memo(getParcellesStats, { maxAge: 6 * ONE_HOUR }),
  getRecord,
  deleteRecord,
  evvLookup,
  evvParcellaire,
  pacageLookup,
  patchFeatureCollection,
  updateAuditRecordState,
  updateFeature,
  parseAPIParcellaireStream,
  parcellaireStreamToDb,
  ...(process.env.NODE_ENV === 'test' ? { evvClient } : {})
}
