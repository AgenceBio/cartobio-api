'use strict'

const { feature, featureCollection, polygon } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
// @ts-ignore
const { extend, HTTPError } = require('got')
const { escapeLiteral } = require('pg')
const JSONStream = require('jsonstream-next')
const { XMLParser } = require('fast-xml-parser')
const { SocksProxyAgent } = require('socks-proxy-agent')

const pool = require('../db.js')
const config = require('../config.js')
const { EtatProduction, CertificationState, EventType, RegionBounds } = require('../enums')
const { parsePacDetailsFromComment, fetchOperatorByNumeroBio, fetchCustomersByOc, fetchCustomersByOcWithRecords, fetchUserOperators } = require('./agence-bio.js')
const { normalizeRecord, normalizeRecordSummary, normalizeEtatProduction } = require('../outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { fromCepageCode } = require('@agencebio/rosetta-cultures/cepages')
const { createNewEvent } = require('../outputs/history.js')
const { InvalidRequestApiError, BadGatewayApiError, NotFoundApiError, ForbiddenApiError } = require('../errors.js')
const { getRandomFeatureId, populateWithMultipleCultures } = require('../outputs/features.js')
const Cursor = require('pg-cursor')
const { addRecordData, applyOperatorTextSearch } = require('../outputs/operator.js')
const bboxPolygon = require('@turf/bbox-polygon').default
const polygonInPolygon = require('@turf/boolean-intersects').default

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
 * @typedef {import('./types/cartobio').OperatorFilter} OperatorFilter
 * @typedef {import('./types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('../outputs/types/api').InputApiRecord} InputApiRecord
 * @typedef {import('../outputs/types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('../outputs/types/features').CartoBioFeatureCollection} CartoBioFeatureCollection
 * @typedef {import('../outputs/types/features').CartoBioFeatureProperties} CartoBioFeatureProperties
 * @typedef {import('../outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('../outputs/types/record').NormalizedRecordSummary} NormalizedRecordSummary
 * @typedef {import('../outputs/types/history').HistoryEntry} HistoryEntry
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */

/* eslint-disable-next-line quotes */
const recordFields = /* sqlFragment */`cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes`

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
          (numerobio, oc_id, oc_label, created_at, metadata, certification_state, certification_date_debut, certification_date_fin, audit_history, audit_date, audit_notes, version_name, annee_reference_controle)
        VALUES ($1, $2, $3, $4, $5, $6, nullif($7, '')::date, nullif($8, '')::date, jsonb_build_array($9::jsonb),
                nullif($10, '')::date, $11, COALESCE($12, 'Version créée le ' || to_char(now(), 'DD/MM/YYYY')), COALESCE(nullif($13, '')::int, DATE_PART('year', COALESCE(nullif($10, '')::date, NOW()))))
        ON CONFLICT (numerobio, audit_date) WHERE cartobio_operators.deleted_at IS NULL
            DO UPDATE
            SET (oc_id, oc_label, updated_at, metadata, certification_state, certification_date_debut, certification_date_fin, audit_history, audit_notes, version_name, annee_reference_controle)
                    = ($2, $3, $4, $5, coalesce($6, cartobio_operators.certification_state),
                       nullif(coalesce($7, cartobio_operators.certification_date_debut::text), '')::date,
                       nullif(coalesce($8, cartobio_operators.certification_date_fin::text), '')::date,
                       (cartobio_operators.audit_history || coalesce($9, '[]')::jsonb),
                       coalesce($11, cartobio_operators.audit_notes), coalesce($12, cartobio_operators.version_name), coalesce(nullif($13, '')::int, cartobio_operators.annee_reference_controle))
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
        /* $12 */ record.version_name,
        /* $13 */ record.annee_reference_controle
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
              reference_cadastre, code_culture_pac, code_precision_pac) =
              (coalesce($3, cartobio_parcelles.commune), coalesce($4, cartobio_parcelles.cultures),
               coalesce($5, cartobio_parcelles.conversion_niveau),
               nullif(coalesce($6::text, cartobio_parcelles.engagement_date::text), '')::date,
               coalesce($7, cartobio_parcelles.commentaire), coalesce($8, cartobio_parcelles.auditeur_notes),
               coalesce($9, cartobio_parcelles.annotations), now(), coalesce($10, cartobio_parcelles.name),
               coalesce($11, cartobio_parcelles.numero_pacage), coalesce($12, cartobio_parcelles.numero_ilot_pac),
               coalesce($13, cartobio_parcelles.numero_parcelle_pac),
               coalesce($14, cartobio_parcelles.reference_cadastre),
               coalesce($15, cartobio_parcelles.code_culture_pac),
               coalesce($16, cartobio_parcelles.code_precision_pac))
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
            /* $14 */ feature.properties.cadastre,
            /* $15 */ feature.properties.TYPE,
            /* $16 */ feature.properties.CODE_VAR
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
                AND cartobio_operators.record_id = $20
                AND cartobio_operators.deleted_at IS NULL
                AND cartobio_parcelles.deleted_at IS NULL
                AND $19
              ORDER BY created_at DESC
              LIMIT 1
          ),
          previous_variete AS (
              SELECT new_cultures->>'CPF' AS CPF, string_agg(DISTINCT(old_cultures->>'variete'), '; ') AS varietes
              FROM previous_version, jsonb_array_elements($5::jsonb) AS new_cultures
              JOIN jsonb_array_elements(previous_version.cultures) AS old_cultures
                  ON (new_cultures->>'CPF') = (old_cultures->>'CPF')
              WHERE $19
              GROUP BY new_cultures->>'CPF'
          ),
          merged_cultures AS (
              SELECT jsonb_agg((SELECT new_cultures || jsonb_build_object('variete', coalesce(new_cultures->>'variete', previous_variete.varietes, '')))) AS cultures
              FROM jsonb_array_elements($5::jsonb) AS new_cultures
              LEFT JOIN previous_variete ON previous_variete.CPF = new_cultures->>'CPF'
              WHERE $19
            )
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
           annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
           reference_cadastre, code_culture_pac, code_precision_pac)
          VALUES ($1, $2, $3, $4, coalesce((SELECT cultures FROM merged_cultures), $5, '[]'::jsonb),
                  coalesce(NULLIF($6, 'AB?'), (SELECT conversion_niveau FROM previous_version), $6),
                  nullif(coalesce($7::text, (SELECT engagement_date FROM previous_version)::text), '')::date, $8,
                  coalesce($9,(SELECT auditeur_notes FROM previous_version)),
                  coalesce($10, '[]'::jsonb),
                  now(), now(), coalesce(NULLIF($11, ''), (SELECT name FROM previous_version)), $12, $13, $14, $15, $17, $18)
          ON CONFLICT (record_id, id)
              DO UPDATE
              SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
                   annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
                   reference_cadastre, code_culture_pac, code_precision_pac) =
                      (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                       coalesce($5, cartobio_parcelles.cultures), coalesce($6, cartobio_parcelles.conversion_niveau),
                       nullif(coalesce($7::text, cartobio_parcelles.engagement_date::text), '')::date,
                       coalesce($8, cartobio_parcelles.commentaire),
                       coalesce($9, cartobio_parcelles.auditeur_notes), coalesce($10, cartobio_parcelles.annotations),
                       now(), coalesce($11, cartobio_parcelles.name), coalesce($12, cartobio_parcelles.numero_pacage),
                       coalesce($13, cartobio_parcelles.numero_ilot_pac), coalesce($14, cartobio_parcelles.numero_parcelle_pac),
                       coalesce($15, cartobio_parcelles.reference_cadastre), coalesce($17, cartobio_parcelles.code_culture_pac),
                       coalesce($18, cartobio_parcelles.code_precision_pac))
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
          /* $17 */ feature.properties.TYPE,
          /* $18 */ feature.properties.CODE_VAR,
          /* $19 */ Boolean(context?.copyParcellesData),
          /* $20 */ context?.previousRecordId || randomUUID()
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
            name, reference_cadastre, code_culture_pac, code_precision_pac)
          (
                SELECT $1, id, geometry, commune, cultures, conversion_niveau, engagement_date, auditeur_notes,
                    name, reference_cadastre, code_culture_pac, code_precision_pac
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
                          AND cartobio_operators.record_id = $3
                          AND cartobio_operators.deleted_at IS NULL
                          AND cartobio_parcelles.deleted_at IS NULL
                        ORDER BY created_at DESC
                        LIMIT 1
                    )
                ORDER BY date DESC
          )
          ON CONFLICT (record_id, id) DO NOTHING
          RETURNING *, ST_AsGeoJSON(geometry)::json as geometry
        `,
        [result.rows.at(0).record_id, result.rows.at(0).numerobio, context.previousRecordId]
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
    WHERE numerobio = $1 AND cartobio_operators.deleted_at IS NULL AND cp.deleted_at IS NULL
    GROUP BY ${recordFields}
    ORDER BY EXTRACT(year from COALESCE(certification_date_debut, audit_date, created_at)) DESC`,
    [numeroBio]
  )

  return rows.map(normalizeRecordSummary)
}

/**
* @param {Object} user
* @param {NormalizedRecord} record
* @param {HistoryEntry} historyEntry
* @param {CartoBioUser} user
* @param {AgenceBioNormalizedOperator} operator
*/
async function setOperatorUpdatedAt (client, record, historyEntry, user, operator) {
  // Add history entry
  return await client.query(
    /* sql */`
    UPDATE cartobio_operators
    SET updated_at = now(),
        audit_history = (audit_history || coalesce($2, '[]')::jsonb),
        oc_id = coalesce(oc_id, $3),
        oc_label = coalesce(oc_label, $4)
    WHERE record_id = $1
    RETURNING ${recordFields}`,
    [
      record.record_id,
      historyEntry,
      // @ts-ignore
      user.organismeCertificateur?.id || operator.organismeCertificateur?.id || null,
      // @ts-ignore
      user.organismeCertificateur?.nom || operator.organismeCertificateur?.nom || null
    ]
  )
}

/**
 * @param {Object} recordInfo
 * @param {CartoBioUser} recordInfo.user
 * @param {NormalizedRecord} recordInfo.record
 * @param {AgenceBioNormalizedOperator} recordInfo.operator
 * @param {Partial<CartoBioFeature>[]} features
 * @returns {Promise<DBOperatorRecord>}
 */
async function patchFeatureCollection ({ user, record, operator }, features) {
  const historyEntry = createNewEvent(
    EventType.FEATURE_COLLECTION_UPDATE,
    { features },
    { user, record }
  )

  // Begin transaction
  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    const { rows: updatedRows } = await setOperatorUpdatedAt(client, record, historyEntry, user, operator)

    for (const feature of features) {
      await client.query(
        /* sql */`
          UPDATE cartobio_parcelles
          SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
               annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
               reference_cadastre, code_culture_pac, code_precision_pac) =
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
                   coalesce($15, cartobio_parcelles.reference_cadastre),
                   coalesce($16, cartobio_parcelles.code_culture_pac),
                   coalesce($17, cartobio_parcelles.code_precision_pac))
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
          /* $15 */ feature.properties.cadastre,
          /* $16 */ feature.properties.TYPE,
          /* $17 */ feature.properties.CODE_VAR
        ]
      )

      if (record.certification_state === 'CERTIFIED') {
        await client.query(
          /* sql */ `
          UPDATE cartobio_operators co
          SET mixite = subquery.mixite
          FROM (
              SELECT
                  co.record_id,
                  CASE
                      WHEN COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END) = COUNT(cp.record_id)
                          THEN 'AB'
                      WHEN (
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) +
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) +
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) +
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)
                      ) = COUNT(cp.record_id)
                          THEN 'ABCONV'
                      WHEN COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) > 1
                          THEN 'MIXTE'
                      ELSE NULL
                  END AS mixite
              FROM cartobio_operators co
              LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
              WHERE co.record_id = $1
              GROUP BY co.record_id
          ) AS subquery
          WHERE co.record_id = subquery.record_id;
          `,
          [record.record_id]
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
 * @param {AgenceBioNormalizedOperator} featureInfo.operator
 * @param {Object} featureData
 * @param {CartoBioFeatureProperties} featureData.properties
 * @param {Polygon} featureData.geometry
 * @returns {Promise<DBOperatorRecord>}
 */
async function updateFeature ({ featureId, user, record, operator }, { properties, geometry }) {
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
    const { rows: updatedRows } = await setOperatorUpdatedAt(client, record, historyEntry, user, operator)

    // Update parcelle
    await client.query(
      /* sql */`
        UPDATE cartobio_parcelles
        SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
             annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
             reference_cadastre, code_culture_pac, code_precision_pac) =
                (coalesce($3, cartobio_parcelles.geometry), coalesce($4, cartobio_parcelles.commune),
                 coalesce($5, cartobio_parcelles.cultures), coalesce($6, cartobio_parcelles.conversion_niveau),
                 nullif(coalesce($7::text, cartobio_parcelles.engagement_date::text), '')::date, coalesce($8, cartobio_parcelles.commentaire),
                 coalesce($9, cartobio_parcelles.auditeur_notes),
                 coalesce($10, cartobio_parcelles.annotations), now(), coalesce($11, cartobio_parcelles.name),
                 coalesce($12, cartobio_parcelles.numero_pacage),
                 coalesce($13, cartobio_parcelles.numero_ilot_pac),
                 coalesce($14, cartobio_parcelles.numero_parcelle_pac),
                 coalesce($15, cartobio_parcelles.reference_cadastre),
                 coalesce($16, cartobio_parcelles.code_culture_pac),
                 coalesce($17, cartobio_parcelles.code_precision_pac))
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
        properties.cadastre,
        properties.TYPE,
        properties.CODE_VAR
      ])

    if (record.certification_state === 'CERTIFIED') {
      await client.query(
        /* sql */ `
        UPDATE cartobio_operators co
        SET mixite = subquery.mixite
        FROM (
            SELECT
                co.record_id,
                CASE
                    WHEN COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END) = COUNT(cp.record_id)
                        THEN 'AB'
                    WHEN (
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)
                    ) = COUNT(cp.record_id)
                        THEN 'ABCONV'
                    WHEN COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) > 1
                        THEN 'MIXTE'
                    ELSE NULL
                END AS mixite
            FROM cartobio_operators co
            LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
            WHERE co.record_id = $1
            GROUP BY co.record_id
        ) AS subquery
        WHERE co.record_id = subquery.record_id;
        `,
        [record.record_id]
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
 * @param {Object} updated
 * @param {Number} updated.featureId
 * @param {CartoBioUser} updated.user
 * @param {NormalizedRecord} updated.record
 * @param {AgenceBioNormalizedOperator} updated.operator
 * @param {Object} context
 * @param {{code: String, details: String?}} context.reason
 * @returns {Promise<DBOperatorRecord>}
 */
async function deleteSingleFeature ({ featureId, user, record, operator }, { reason }) {
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
    const { rows: updatedRows } = await setOperatorUpdatedAt(client, record, historyEntry, user, operator)

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
 * @param {AgenceBioNormalizedOperator} recordInfo.operator
 * @param {CartoBioFeature} feature
 * @returns {Promise<DBOperatorRecord>}
 */
async function addRecordFeature ({ user, record, operator }, feature) {
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
         reference_cadastre, code_culture_pac, code_precision_pac)
        VALUES ($1, $2, $3, $4, coalesce($5, '[]')::jsonb, $6, $7, $8, $9, coalesce($10, '[]')::jsonb, now(), now(),
                $11, $12, $13, $14, $15, $16, $17)`,
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
        feature.properties.cadastre,
        feature.properties.TYPE,
        feature.properties.CODE_VAR
      ]
    )
    // Add history entry
    const { rows: updatedRows } = await setOperatorUpdatedAt(client, record, historyEntry, user, operator)

    if (record.certification_state === 'CERTIFIED') {
      await client.query(
        /* sql */ `
        UPDATE cartobio_operators co
        SET mixite = subquery.mixite
        FROM (
            SELECT
                co.record_id,
                CASE
                    WHEN COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END) = COUNT(cp.record_id)
                        THEN 'AB'
                    WHEN (
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)
                    ) = COUNT(cp.record_id)
                        THEN 'ABCONV'
                    WHEN COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) > 1
                        THEN 'MIXTE'
                    ELSE NULL
                END AS mixite
            FROM cartobio_operators co
            LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
            WHERE co.record_id = $1
            GROUP BY co.record_id
        ) AS subquery
        WHERE co.record_id = subquery.record_id;
        `,
        [record.record_id]
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
 * Add or divide a feature.
 *
 * @param {CartoBioUser} user - The user performing the operation.
 * @param {NormalizedRecord} record - The record containing the feature.
 * @param {AgenceBioNormalizedOperator} operator
 * @param {CartoBioFeatureCollection} features - The features to add or divide.
 * @param {Object} info - Additional information.
 * @returns {Promise<DBOperatorRecord>} - The updated record.
 */
async function addDividFeature (user, record, operator, features, info) {
  /** @type {HistoryEntry} */
  let historyEntry = null

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    if (features.features.length === 1) {
      historyEntry = createNewEvent(
        EventType.FEATURE_UPDATE,
        { features: [features.features[0]], description: 'Parcelles ajoutées' },
        { user, record }
      )
      await client.query(
      /* sql */`
        UPDATE cartobio_parcelles
        SET geometry = $3, commune = $4, cultures = $5, conversion_niveau = $6, engagement_date = $7, commentaire = $8, auditeur_notes = $9,
        annotations = $10, updated = now(), name = $11, numero_pacage = $12, numero_ilot_pac = $13, numero_parcelle_pac = $14,
        reference_cadastre = $15, code_culture_pac = $16, code_precision_pac = $17
        WHERE record_id = $1 AND id = $2`,
        [
          info.recordId,
          info.featureId,
          features.features[0].geometry,
          features.features[0].properties.COMMUNE,
          JSON.stringify(features.features[0].properties.cultures),
          features.features[0].properties.conversion_niveau,
          features.features[0].properties.engagement_date,
          features.features[0].properties.commentaires,
          features.features[0].properties.auditeur_notes,
          JSON.stringify(features.features[0].properties.annotations),
          features.features[0].properties.NOM,
          features.features[0].properties.PACAGE,
          features.features[0].properties.NUMERO_I,
          features.features[0].properties.NUMERO_P,
          features.features[0].properties.cadastre,
          features.features[0].properties.TYPE,
          features.features[0].properties.CODE_VAR
        ])
      const { rows: updatedRows } = await setOperatorUpdatedAt(client, record, historyEntry, user, operator)

      if (record.certification_state === 'CERTIFIED') {
        await client.query(
          /* sql */ `
          UPDATE cartobio_operators co
          SET mixite = subquery.mixite
          FROM (
              SELECT
                  co.record_id,
                  CASE
                      WHEN COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END) = COUNT(cp.record_id)
                          THEN 'AB'
                      WHEN (
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) +
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) +
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) +
                          COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)
                      ) = COUNT(cp.record_id)
                          THEN 'ABCONV'
                      WHEN COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) > 1
                          THEN 'MIXTE'
                      ELSE NULL
                  END AS mixite
              FROM cartobio_operators co
              LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
              WHERE co.record_id = $1
              GROUP BY co.record_id
          ) AS subquery
          WHERE co.record_id = subquery.record_id;
          `,
          [record.record_id]
        )
      }

      await client.query('COMMIT;')
      return joinRecordParcelles(updatedRows.at(0))
    } else {
      historyEntry = createNewEvent(
        EventType.FEATURE_CREATE,
        { features: features.features, description: 'Parcelles ajoutées' },
        { user, record }
      )
      await client.query(
        /* sql */`
          UPDATE cartobio_parcelles
          SET deleted_at = now()
          WHERE record_id = $1 AND id = $2`,
        [
          info.recordId,
          info.featureId
        ]
      )
      for (const feature of features.features) {
        const newId = Date.now() + Math.round(Math.random() * 1000)

        await client.query(
          /* sql */`
            INSERT INTO cartobio_parcelles
            (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
            annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
            reference_cadastre,  code_culture_pac, code_precision_pac, from_parcelles)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            record.record_id,
            newId,
            feature.geometry,
            feature.properties.COMMUNE,
            JSON.stringify(feature.properties.cultures),
            feature.properties.conversion_niveau,
            feature.properties.engagement_date,
            feature.properties.commentaires,
            feature.properties.auditeur_notes,
            JSON.stringify(feature.properties.annotations),
            feature.properties.NOM,
            feature.properties.PACAGE,
            feature.properties.NUMERO_I,
            feature.properties.NUMERO_P,
            feature.properties.cadastre,
            feature.properties.TYPE,
            feature.properties.CODE_VAR,
            info.featureId
          ]
        )
      }
    }

    // Add history entry
    const { rows: updatedRows } = await setOperatorUpdatedAt(client, record, historyEntry, user, operator)

    if (record.certification_state === 'CERTIFIED') {
      await client.query(
        /* sql */ `
        UPDATE cartobio_operators co
        SET mixite = subquery.mixite
        FROM (
            SELECT
                co.record_id,
                CASE
                    WHEN COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END) = COUNT(cp.record_id)
                        THEN 'AB'
                    WHEN (
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) +
                        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)
                    ) = COUNT(cp.record_id)
                        THEN 'ABCONV'
                    WHEN COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) > 1
                        THEN 'MIXTE'
                    ELSE NULL
                END AS mixite
            FROM cartobio_operators co
            LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
            WHERE co.record_id = $1
            GROUP BY co.record_id
        ) AS subquery
        WHERE co.record_id = subquery.record_id;
        `,
        [record.record_id]
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
 * @param {Number} numeroBio
 * @param {Number} userId
 * @return {Promise<void>}
 */
async function pinOperator (numeroBio, userId) {
  await pool.query(
    /* sql */`
      INSERT INTO operateurs_epingles (numerobio, user_id)
      VALUES ($1, $2)
      ON CONFLICT (numerobio, user_id) DO NOTHING`,
    [numeroBio, userId]
  )
}

/**
 * @param {Number} numeroBio
 * @param {Number} userId
 * @return {Promise<void>}
 */
async function unpinOperator (numeroBio, userId) {
  await pool.query(
    /* sql */`
      DELETE FROM operateurs_epingles
      WHERE numerobio = $1 AND user_id = $2`,
    [numeroBio, userId]
  )
}

/**
 * @param {Number} numeroBio
 * @param {Number} userId
 * @return {Promise<void>}
 */
async function consultOperator (numeroBio, userId) {
  await pool.query(
    /* sql */`
      INSERT INTO operateurs_consultes (numerobio, user_id)
      VALUES ($1, $2)
      ON CONFLICT (numerobio, user_id) DO UPDATE SET
          created_at = now()`,
    [numeroBio, userId]
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

const NOTIF_PRIORITY = {
  BROUILLON: 0,
  ARRETEE: 1,
  'NON ENGAGEE': 4,
  'ENGAGEE FUTUR': 5,
  SUSPENDUE: 3,
  ENGAGEE: 6,
  RETIREE: 2
}

const RECORD_SORTS = {
  audit_date: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })
      return function sortByAuditDate (a, b) {
        if (!a.audit_date && !!b.audit_date) {
          return (order === 'asc' ? SORT.DESCENDING : SORT.ASCENDING)
        } else if (!!a.audit_date && !b.audit_date) {
          return (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
        } if (!a.audit_date && !b.audit_date) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

        return collator.compare(a.audit_date, b.audit_date) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
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
        const aNotif = a.notifications
        const bNotif = b.notifications

        if (aNotif?.dateDemarrage == null && bNotif?.dateDemarrage != null) {
          return (order === 'asc' ? SORT.DESCENDING : SORT.ASCENDING)
        } else if (bNotif?.dateDemarrage == null && aNotif?.dateDemarrage != null) {
          return (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
        } else if (bNotif?.dateDemarrage == null && aNotif?.dateDemarrage == null) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

        return collator.compare(aNotif.dateDemarrage, bNotif.dateDemarrage) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql () {
      // we are not supposed to enter this case
      return 'audit_date DESC NULLS LAST'
    }
  },
  notifications: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })

      return function sortByNotifications (a, b) {
        const aNotif = a.notifications?.etatCertification ?? 'BROUILLON'
        const bNotif = b.notifications?.etatCertification ?? 'BROUILLON'

        if (aNotif === bNotif) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

        return (NOTIF_PRIORITY[aNotif] - NOTIF_PRIORITY[bNotif]) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
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
        const nameA = a.nom || a.denominationCourante || ''
        const nameB = b.nom || b.denominationCourante || ''

        const startsWithSpecial = (str) => /^[^a-zA-Z]/.test(str)

        const isSpecialA = startsWithSpecial(nameA)
        const isSpecialB = startsWithSpecial(nameB)

        if (isSpecialA && !isSpecialB) return 1
        if (!isSpecialA && isSpecialB) return -1

        return collator.compare(nameA, nameB) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql () {
      // we are not supposed to enter this case
      return 'audit_date DESC NULLS LAST'
    }
  },
  statut: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })

      return function sortByStatut (a, b) {
        if (a.certification_state === b.certification_state) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

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

/**
 * @param  {{ocId: number, userId: number, input: string, page: number, filter: OperatorFilter, limit?: number }} params
 * @returns {Promise<{pagination: { page: number, total: number, page_max: number }, records: AgenceBioNormalizedOperatorWithRecord[]}>}
 */
async function searchControlBodyRecords ({ ocId, userId, input, page, filter, limit = 7 }) {
  const [, siret = '', numeroBio = '', nom = ''] = input.trim().match(/^(\d{14})|(\d+)|(.+)$/) ?? []
  const PER_PAGE = Math.min(limit, 50)
  let pinnedOperators = null

  if (filter?.pinned === true) {
    pinnedOperators = await getPinnedOperators(userId)
  }

  // we search by input — all operators comes hydrated from the Agence Bio API
  // all we have then to do is to recoup with record states
  // pagination is software-based
  const records = await Promise.all(
    [
      pinnedOperators ? Promise.resolve(pinnedOperators) : getPinnedOperators(userId),
      fetchCustomersByOcWithRecords({ siret, ocId, numeroBio, nom }, filter, pinnedOperators)
    ]
  )
    .then(([numeroBioPinned, records]) => {
      if (filter) {
        const temporisation = records.filter(item => {
          if (filter.etatCertification != null && filter.etatCertification !== 'ALL') {
            const estCertifie = item.states &&
              item.states.length > 0 &&
              item.states.some(
                (state) => state.certification_state === 'CERTIFIED' && state.annee_reference_controle === filter.anneeReferenceCertification
              )

            if (filter.etatCertification === 'CERTIFIED' && !estCertifie) {
              return false
            }

            if (filter.etatCertification === 'NO_CERTIFIED' && estCertifie) {
              return false
            }
          }

          if (filter.statutParcellaire &&
            filter.statutParcellaire.length > 0) {
            let states = item.states ?? []

            if (states.length > 0 && filter.anneeReferenceCertification) {
              states = states.filter((state) => state.annee_reference_controle === filter.anneeReferenceCertification)
            }

            // Aucun parcellaire sur l'année de reference
            if (states.length === 0 && !filter.statutParcellaire.includes('NONE')) {
              return false
            }

            if (states.length > 0 && !states.some((state) => filter.statutParcellaire.includes(state.certification_state))) {
              return false
            }
          }

          if (filter.engagement && filter.engagement.length > 0) {
            if (!filter.engagement.includes(item.lastmixitestate)) return false
          }

          return true
        })
        return temporisation.map((r) => ({ ...r, epingle: numeroBioPinned.includes(+r.numeroBio) }))
      }

      return records.map((r) => ({ ...r, epingle: numeroBioPinned.includes(+r.numeroBio) }))
    })
    .then(records => records.toSorted(recordSorts('fn', 'nom', 'asc')))

  const pagination = {
    page,
    total: records.length,
    page_max: Math.max(Math.ceil(records.length / PER_PAGE), 1)
  }

  const pageRecords = records.slice(
    (pagination.page - 1) * PER_PAGE,
    (pagination.page) * PER_PAGE).map((record) => addRecordData(record))
  return {
    pagination,
    records: await Promise.all(pageRecords)
  }
}

/**
 * @param {Number} ocId
 * @param {Number} userId
 * @param {String} input
 * @return {Promise<any []>}
 */
async function searchForAutocomplete (ocId, userId, input) {
  const records = ocId ? await fetchCustomersByOc(ocId) : (await fetchUserOperators(userId)).operators
  const search = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const [, siret = '', numeroBio = '', nom = ''] = search.trim().match(/^(\d{14})|(\d+)|(.+)$/) ?? []

  return records.filter((record) => applyOperatorTextSearch(record, siret, numeroBio, nom))
    .map((record) => (
      {
        numeroBio: record.numeroBio,
        nom: record.nom,
        denominationCourante: record.denominationCourante,
        siret: record.siret,
        numeroClient: record.notifications?.numeroClient
      }))
}

/**
 * @param {Number} ocId
 * @param {String[]}departements
 * @param {Number} anneeReferenceControle
 * @return {Promise<{ countCertifiees: number, countEnAttentes: number, countNonAuditees: number}>}
 */
async function getDashboardSummary (ocId, departements, anneeReferenceControle) {
  const records = await fetchCustomersByOc(ocId)

  const numeroBios = records
    .filter(
      (item) => (departements.length === 0 || departements.includes(item.departement)) &&
      item.notifications &&
      ['ENGAGEE', 'ENGAGEE FUTUR'].includes(item.notifications.etatCertification) &&
      item.notifications.dateDemarrage && new Date(item.notifications.dateDemarrage).getFullYear() <= anneeReferenceControle &&
      item.isProduction === true
    )
    .map((r) => r.numeroBio)

  const { rows } = await pool.query(
    /* sql */`
      SELECT
        (certification_state = 'CERTIFIED') as certifie,
        JSON_AGG(DISTINCT(numerobio)) as numerobios
      FROM cartobio_operators
      WHERE numerobio = ANY ($1)
        AND deleted_at IS NULL
        AND annee_reference_controle = $2
        AND certification_state IN ('AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED')
      GROUP BY certification_state = 'CERTIFIED'`,
    [numeroBios, anneeReferenceControle]
  )

  const certifiees = rows.find((r) => r.certifie === true)?.numerobios ?? []
  const enAttentes = rows.find((r) => r.certifie === false)?.numerobios ?? []

  const countCertifiees = certifiees.length
  const countEnAttentes = enAttentes.filter((e) => !certifiees.includes(e)).length

  return {
    countCertifiees,
    countEnAttentes,
    countNonAuditees: numeroBios.length - countCertifiees - countEnAttentes
  }
}

/**
 * @param {Object} recordInfo
 * @param {CartoBioUser} recordInfo.user
 * @param {NormalizedRecord} recordInfo.record
 * @param {AgenceBioNormalizedOperator} recordInfo.operator
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
async function updateAuditRecordState ({ user, record, operator }, patch) {
  // @ts-ignore
  if (record.oc_id !== null && user.organismeCertificateur && record.oc_id !== user.organismeCertificateur.id) {
    throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier de ce parcellaire.")
  }

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

  if (record.oc_id === null) {
    // @ts-ignore
    const ocId = user.organismeCertificateur?.id || operator.organismeCertificateur?.id || null
    // @ts-ignore
    const ocNom = user.organismeCertificateur?.nom || operator.organismeCertificateur?.nom || null

    if (ocId) {
      columns.push('oc_id')
      placeholders.push(`$${columns.length + 1}`)
      values.push(ocId)

      columns.push('oc_label')
      placeholders.push(`$${columns.length + 1}`)
      values.push(ocNom)
    }
  }

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

    if (state === CertificationState.CERTIFIED && !columns.includes('mixite')) {
      const { rows } = await pool.query(/* sql */
`SELECT
       CASE
           WHEN parcelles_data.nombre_AB = parcelles_data.nombre_parcelles THEN 'AB'
           WHEN parcelles_data.total_non_conventionnel = parcelles_data.nombre_parcelles THEN 'ABCONV'
           WHEN (parcelles_data.nombre_conventionnel > 1) THEN 'MIXTE'
       END AS mixite
FROM (
    SELECT
        co.record_id,
        COUNT(cp.record_id) AS nombre_parcelles,
        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) AS nombre_conventionnel,
        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) AS nombre_C1,
        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) AS nombre_C2,
        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) AS nombre_C3,
        COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0) AS nombre_AB,
        (COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) +
         COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) +
         COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) +
         COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)) AS total_non_conventionnel
    FROM cartobio_operators co
    LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
    WHERE co.record_id = $1
    GROUP BY co.record_id
) AS parcelles_data;
`,
[
  record.record_id
])

      columns.push('mixite')
      placeholders.push(`$${columns.length + 1}`)
      values.push(rows[0].mixite)
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
        WHERE record_id = $1 and deleted_at IS NULL
        ORDER BY created ASC`,
      [record.record_id]
    )

    return { ...record, parcelles: rows }
  }

  return { ...record, parcelles: record?.parcelles ?? [] }
}

/**
 * @generator
 * @param {NodeJS.ReadableStream} stream - a Json Stream
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @yields {{ record: Partial<NormalizedRecord>, error: Error?, warnings: Array<{numeroBio: String, message: String}> }}
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  /**
   * @type {Promise<InputApiRecord>[]}
   */
  const streamRecords = stream.pipe(JSONStream.parse([true]))
  const warnings = []

  for await (const record of streamRecords) {
    const operator = await fetchOperator(String(record.numeroBio))

    if (operator == null) {
      warnings.push({ numeroBio: String(record.numeroBio), message: 'Numéro bio inconnu du portail de notification' })
    } else if (!operator.isProduction) {
      warnings.push({ numeroBio: String(record.numeroBio), message: 'Numéro bio sans notification liée à une activité de production' })
    }

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

    const features = await Promise.all(record.parcelles
      // turn products into features
      .map(async (parcelle) => {
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
          NUMERO_I: Number.isNaN(numeroIlot) ? (pac.numeroIlot ?? null) : String(numeroIlot),
          NUMERO_P: Number.isNaN(numeroParcelle) ? (pac.numeroParcelle ?? null) : String(numeroParcelle),
          PACAGE: record.numeroPacage ? String(record.numeroPacage) : null,
          conversion_niveau: conversionNiveau,
          engagement_date: parcelle.dateEngagement ?? null,
          auditeur_notes: parcelle.commentaire ?? null,
          TYPE: parcelle.codeCulture ?? null,
          CODE_VAR: parcelle.codePrecision ?? null
        }

        let coordinates = []

        if (parcelle.geom === null || parcelle.geom === undefined || parcelle.geom === '' || parcelle.geom === 'null') {
          warnings.push({ numeroBio: String(record.numeroBio), message: `Parcelle ${id ?? ''} n'a pas de géométrie` })
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

        let resPolygon

        try {
          resPolygon = polygon(coordinates, properties, { id })
        } catch (error) {
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          return null
        }

        const isValidPolygon = await pool.query('SELECT ST_IsValid($1::geometry) AS valid', [resPolygon.geometry])
        if (!isValidPolygon.rows[0].valid) {
          warnings.push({ numeroBio: String(record.numeroBio), message: `Parcelle ${id ?? ''} a une géométrie invalide` })
        }

        for (const [, bbox] of Object.entries(RegionBounds)) {
          // @ts-ignore BBox and number[] error is confusing
          const regionGeometry = bboxPolygon(bbox)

          if (polygonInPolygon(resPolygon, regionGeometry)) {
            return resPolygon
          }
        }

        warnings.push({ numeroBio: String(record.numeroBio), message: `Parcelle ${id ?? ''} en dehors des régions autorisées` })
        return resPolygon
      }))

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
        annee_reference_controle: record.anneeReferenceControle,
        metadata: {
          source: 'API Parcellaire',
          sourceLastUpdate: new Date().toISOString(),
          anneeAssolement: record.anneeAssolement
        }
      },
      warnings: warnings
    }
  }
}

/**
 * @param {NodeJS.ReadableStream} stream
 * @param {OrganismeCertificateur} organismeCertificateur
 * @returns {Promise<{count: number, errors: Array<[Number, String]>,warning: Array<[Number,Array<{ numeroBio: String, message: String}>]>}>}
 */
async function parcellaireStreamToDb (stream, organismeCertificateur) {
  const generator = parseAPIParcellaireStream(stream, { organismeCertificateur })
  let count = 0
  /** @type {Array<[Number, String]>} */
  const errors = []
  /** @type {Array<[Number,Array<{numeroBio: String, message: String}>]>} */
  const warning = []

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    for await (const { record, error, warnings } of generator) {
      count++
      if (error) {
        errors.push([count, error.message])
        continue
      }
      if (warnings) {
        warning.push([count, warnings])
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

  await client.query('COMMIT;')
  client.release()
  return { count, errors, warning }
}

/**
 * Return operator data from agencebio api
 *
 * @param {string} enter - The NumeroBio to be fetched.
 * @returns {Promise<AgenceBioNormalizedOperator>} - A promise that return operator data if it exists or null.
 */
async function fetchOperator (enter) {
  try {
    return await fetchOperatorByNumeroBio(enter)
  } catch (error) {
    return null
  }
}

/**
 * Return operator data from agencebio api
 *
 * @returns {Promise<any>} - A promise that return operator data if it exists or null.
 */
async function getDepartement () {
  try {
    const { rows } = await pool.query(
      /* SQL */ `
        SELECT
          CASE
            WHEN LENGTH(d.code) = 3 THEN 'DOM-TOM'
            ELSE r.nom
          END AS nom_region,
          d.code,
          d.nom
        FROM departement d
        LEFT JOIN region r ON d.code_region = r.code;
      `
    )

    const result = rows.reduce((acc, row) => {
      const { nom_region: nomRegion, code, nom } = row

      if (!acc[nomRegion]) {
        acc[nomRegion] = []
      }

      acc[nomRegion].push({ code, nom })

      return acc
    }, {})

    const sortedResult = Object.keys(result)
      .sort()
      .reduce((acc, key) => {
        acc[key] = result[key].sort((a, b) => a.nom.localeCompare(b.nom))
        return acc
      }, {})

    return sortedResult
  } catch (error) {
    console.log(error)
    return null
  }
}

/*
 * Return data for create XLSX File export
 *
 * @param {string} ocId - The ocId to be fetched
 * @returns {Promise<any>} - A primise that return data if it exists or null
*/
async function exportDataOcId (ocId) {
  try {
    const { rows } = await pool.query(
      /* sql */ `
      SELECT
      co.record_id,
      co.numerobio,
      co.version_name,
      co.metadata->>'source' as source,
      co.metadata->>'provenance' as provenance,
      co.created_at,
      co.updated_at,
      co.mixite as mixite,
      co.annee_reference_controle as anneereference,
      co.certification_state,
      COALESCE(NULLIF(co.audit_date, '1970-01-01'), NULL) AS audit_date,
      co.audit_notes,
      COALESCE(NULLIF(co.certification_date_debut, '1970-01-01'), NULL) AS certification_date_debut,
      COALESCE(NULLIF(co.certification_date_fin, '1970-01-01'), NULL) AS certification_date_fin,
      COUNT(cp.record_id) AS nombre_parcelles,
      COALESCE(ROUND(SUM(ST_Area(ST_Transform(cp.geometry, 2154)) / 10000)::numeric,2), 0) AS superficie_totale_ha,
      COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'CONV' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric,2), 0) AS surface_conventionnel_ha,
      COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'C1' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric,2), 0) AS surface_C1_ha,
      COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'C2' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric,2), 0) AS surface_C2_ha,
      COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'C3' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric,2), 0) AS surface_C3_ha,
      COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'AB' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric,2), 0) AS surface_AB_ha
      FROM cartobio_operators co
      LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
      WHERE co.oc_id = $1
      GROUP BY co.record_id
      ORDER BY CAST(co.numerobio AS INTEGER) ASC, co.created_at DESC;
      `,
      [ocId]
    )
    const operatorCache = {}

    for (const row of rows) {
      if (!operatorCache[row.numerobio]) {
        operatorCache[row.numerobio] = await fetchOperatorByNumeroBio(row.numerobio)
      }
      row.numeroclient = operatorCache[row.numerobio].notifications.numeroClient
      row.siret = operatorCache[row.numerobio].siret
      row.raisonSociale = operatorCache[row.numerobio].nom
      row.codePostal = operatorCache[row.numerobio].codePostal
      row.commune = operatorCache[row.numerobio].commune
    }
    return rows
  } catch (error) {
    console.log(error)
    return null
  }
}

/**
 * @param userId
 * @return {Promise<number[]>}
 */
async function getPinnedOperators (userId) {
  const { rows } = await pool.query(
    /* sql */`
    SELECT numerobio
    FROM operateurs_epingles
    WHERE user_id = $1
    ORDER BY created_at DESC`,
    [userId]
  )

  return rows.map((r) => r.numerobio)
}

module.exports = {
  addRecordFeature,
  addDividFeature,
  deleteSingleFeature,
  createOrUpdateOperatorRecord,
  getRecords,
  getOperatorLastRecord,
  iterateOperatorLastRecords,
  searchControlBodyRecords,
  searchForAutocomplete,
  getDashboardSummary,
  getRecord,
  deleteRecord,
  pinOperator,
  unpinOperator,
  evvLookup,
  evvParcellaire,
  pacageLookup,
  patchFeatureCollection,
  updateAuditRecordState,
  updateFeature,
  parseAPIParcellaireStream,
  parcellaireStreamToDb,
  getDepartement,
  recordSorts,
  getPinnedOperators,
  consultOperator,
  exportDataOcId,
  ...(process.env.NODE_ENV === 'test' ? { evvClient } : {})
}
