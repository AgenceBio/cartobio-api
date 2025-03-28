'use strict'

const { feature, featureCollection, polygon } = require('@turf/helpers')
// @ts-ignore
const { toWgs84 } = require('reproject')
// @ts-ignore
const { extend, HTTPError } = require('got')
const { escapeLiteral } = require('pg')
// @ts-ignore
const JSONStream = require('jsonstream-next')
const { XMLParser } = require('fast-xml-parser')
const { SocksProxyAgent } = require('socks-proxy-agent')

const pool = require('../db.js')
const config = require('../config.js')
const { EtatProduction, CertificationState, EventType, RegionBounds } = require('../enums')
const { parsePacDetailsFromComment, fetchOperatorByNumeroBio, fetchCustomersByOc, fetchCustomersByOcWithRecords, fetchUserOperators } = require('./agence-bio.js')
const { normalizeRecord, normalizeRecordSummary, normalizeEtatProduction } = require('../outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodePacStrict, fromCodeCpf } = require('@agencebio/rosetta-cultures')
// @ts-ignore
const { fromCepageCode } = require('@agencebio/rosetta-cultures/cepages')
const { createNewEvent } = require('../outputs/history.js')
const { InvalidRequestApiError, BadGatewayApiError, NotFoundApiError, ForbiddenApiError } = require('../errors.js')
const { getRandomFeatureId, populateWithMultipleCultures } = require('../outputs/features.js')
// @ts-ignore
const Cursor = require('pg-cursor')
const { addRecordData, applyOperatorTextSearch, filterOperatorForAutocomplete, sortRecord } = require('../outputs/operator.js')
const bboxPolygon = require('@turf/bbox-polygon').default
const polygonInPolygon = require('@turf/boolean-intersects').default

const fs = require('fs')
const pdflib = require('pdf-lib')
const path = require('path')
const puppeteer = require('puppeteer')
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
    // @ts-ignore
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
      fetchCustomersByOcWithRecords(input, ocId, filter, pinnedOperators)
    ]
  )
    .then(([numeroBioPinned, records]) => {
      records = records.filter((item) => {
        if (item.list_oc_id != null && item.list_oc_id.length > 0 && item.list_oc_id.includes(ocId)) {
          return true
        }

        if (item.notifications.organismeCertificateurId === ocId && ['ARRETEE', 'RETIREE'].includes(item.notifications.etatCertification)) {
          return false
        }

        return item.notifications.organismeCertificateurId === ocId
      })

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

  const pageRecords = records.sort((a, b) => sortRecord(a, b, filter.sort)).slice(
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
  const records = ocId ? (await fetchCustomersByOc(ocId)).filter((operator) => filterOperatorForAutocomplete(operator, ocId)) : (await fetchUserOperators(userId)).operators

  return records.filter((record) => applyOperatorTextSearch(record, input))
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

/**
 * Return data for create XLSX File export
 *
 * @param {number} ocId - The ocId to be fetched
 * @returns {Promise<any>} - A primise that return data if it exists or null
 */
async function exportDataOcId (ocId) {
  try {
    const operators = await fetchCustomersByOc(ocId)
    const sortedOperators = operators.sort((a, b) => (+a.numeroBio - +b.numeroBio))
    const ids = sortedOperators.map(({ numeroBio }) => String(numeroBio))
    let results = []
    let index = 0
    const limit = 10000

    while (index < ids.length) {
      const idsSlice = ids.slice(index, index + limit)
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
        AND numerobio = ANY ($2)
        AND co.deleted_at IS NULL
        AND cp.deleted_at IS NULL
        GROUP BY co.record_id
        ORDER BY co.numerobio::bigint ASC
        `,
        [ocId, idsSlice]
      )
      results = results.concat(rows)

      index += limit
    }

    let j = 0
    for (const row of results) {
      while (+sortedOperators[j].numeroBio !== +row.numerobio) {
        j++
      }
      const operator = sortedOperators[j]

      if (!operator) {
        continue
      }

      row.numeroclient = operator.notifications?.numeroClient ?? ''
      row.siret = operator.siret
      row.raisonSociale = operator.nom
      row.codePostal = operator.codePostal
      row.commune = operator.commune
    }
    return results
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

/**
 * Lancer le navigateur
 * @param {Object} browser
 * @param {Object} styleConfig
 * @param {string} styleConfig.name
 * @param {string} [styleConfig.styleUrl]
 * @returns {Promise<Object>}
 */
async function launchStyleTab (browser, { name, styleUrl }) {
  const page = await browser.newPage()
  const filePath = `file://${path.resolve(__dirname, '../../image-map/map.html')}`
  await page.goto(filePath, { waitUntil: 'networkidle2' })

  const style = styleUrl
  await page.evaluate(
    (style) => {
      // @ts-ignore
      // eslint-disable-next-line no-undef
      map.setStyle(style)
    },
    style
  )

  return { name, page }
}

/**
 * Parser le map style
 * @returns {Promise<Array>}
 */
function parseMapStyles () {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(__dirname, '../../image-map/mapstyles.json'), (error, json) => {
      if (error) {
        reject(error)
      } else {
        // @ts-ignore
        resolve(JSON.parse(json))
      }
    })
  })
}

/**
 * Recuperer la page avec le bon style
 * @param {Array} tabs
 * @param {string} styleName
 * @returns {Object}
 */
const getPage = (tabs, styleName) => {
  const tab = tabs.find(tab => tab.name === styleName)
  if (!tab) {
    console.warn(`Unknown style name '${styleName}'. Fallback to first style '${tabs[0].name}'.`)
    return tabs[0].page
  }
  return tab.page
}

/**
 * Calculer le zoom optimal pour la parcelle
 * @param {number} bboxWidth
 * @param {number} bboxHeight
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {number}
 */
function getOptimalZoom (bboxWidth, bboxHeight, viewportWidth, viewportHeight) {
  const WORLD_DIM = { width: 512, height: 512 }
  const ZOOM_MAX = 20

  function latRad (lat) {
    const sin = Math.sin((lat * Math.PI) / 180)
    const result = Math.log((1 + sin) / (1 - sin)) / 2
    return result
  }

  function zoom (mapPx, worldPx, fraction) {
    return Math.floor(Math.log(mapPx / worldPx / fraction) / Math.LN2)
  }

  const latFraction = (latRad(bboxHeight) - latRad(0)) / Math.PI
  const lngFraction = bboxWidth / 360

  const zoomX = zoom(viewportWidth, WORLD_DIM.width, lngFraction)
  const zoomY = zoom(viewportHeight, WORLD_DIM.height, latFraction)

  return Math.min(zoomX, zoomY, ZOOM_MAX)
}

/**
 * Récupère toutes les parcelles d'un opérateur
 * @param {string} recordId - L'ID de l'enregistrement de l'opérateur
 * @returns {Promise<Array>} - Tableau des parcelles
 */
async function getAllParcelles (recordId) {
  try {
    const result = await pool.query(/* sql */`
    SELECT
     id,
     name,
     cultures,
     conversion_niveau,
     commune,
     created,
     auditeur_notes,
     engagement_date,
     numero_ilot_pac AS nbilot,
     numero_parcelle_pac AS nbp,
     reference_cadastre as refcad,
     ST_AsGeoJSON(geometry) AS geojson,
     ST_XMin(geometry) AS minX,
     ST_YMin(geometry) AS minY,
     ST_XMax(geometry) AS maxX,
     ST_YMax(geometry) AS maxY,
     ST_X(ST_Centroid(geometry)) AS centerX,
     ST_Y(ST_Centroid(geometry)) AS centerY,
     COALESCE(SUM(ST_Area(ST_Transform(geometry, 2154)) / 10000), 0) AS superficie_totale_ha
      FROM cartobio_parcelles
      WHERE record_id = $1
      GROUP BY id, name, cultures, conversion_niveau, created, auditeur_notes, numero_ilot_pac, numero_parcelle_pac, geometry,engagement_date,commune,reference_cadastre;
      `,
    [recordId]
    )

    return result.rows.map(row => ({
      id: row.id,
      geojson: JSON.parse(row.geojson),
      minx: row.minx,
      miny: row.miny,
      maxx: row.maxx,
      maxy: row.maxy,
      centerx: row.centerx,
      centery: row.centery,
      ...row
    }))
  } catch (error) {
    console.error('Erreur lors de la récupération des parcelles:', error)
    return []
  }
}

/**
 * Calcule la bounding box englobant toutes les parcelles
 * @param {Array} parcelles - Tableau de parcelles
 * @returns {Object} - Bounding box et centre
 */
function calculateGlobalBoundingBox (parcelles) {
  if (parcelles.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  parcelles.forEach(parcelle => {
    minX = Math.min(minX, parcelle.minx)
    minY = Math.min(minY, parcelle.miny)
    maxX = Math.max(maxX, parcelle.maxx)
    maxY = Math.max(maxY, parcelle.maxy)
  })

  return {
    minx: minX,
    miny: minY,
    maxx: maxX,
    maxy: maxY,
    centerx: (minX + maxX) / 2,
    centery: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY
  }
}

/**
 * Dessine toutes les parcelles sur la carte
 * @param {Object} page - Page Puppeteer
 * @param {Array} parcelles - Tableau des parcelles à dessiner
 * @param {Object} options - Options de dessin
 * @returns {Promise<Object>} - Résultat avec buffer ou erreur
 */
async function drawAllParcellesOnMap (page, parcelles, { width, height, center, zoom, timeout }) {
  await page.setViewport({ width, height })

  await page.waitForSelector('body.loading', { hidden: true, timeout })
  // @ts-ignore
  // eslint-disable-next-line no-undef
  await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })

  const error = await page.evaluate(
    ({ parcelles, center, zoom }) => {
      try {
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.jumpTo({ center, zoom })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        if (map.getSource('parcelles')) {
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeLayer('parcelles-layer')
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeSource('parcelles')
        }
        const features = parcelles.map(parcelle => ({
          type: 'Feature',
          geometry: JSON.parse(parcelle.geojson),
          properties: { id: parcelle.id }
        }))
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addSource('parcelles', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: features
          }
        })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addLayer({
          id: 'parcelles-layer',
          type: 'fill',
          source: 'parcelles',
          paint: {
            'fill-color': 'rgba(240, 238, 237, 0.8)',
            'fill-outline-color': 'blue'
          }
        })
        return null
      } catch (err) {
        return `Erreur lors du rendu des parcelles : ${err.message}`
      }
    },
    { parcelles, center, zoom }
  )
  if (error) return { error }

  try {
    await page.waitForSelector('body.loading', { hidden: true, timeout })
    // @ts-ignore
    // eslint-disable-next-line no-undef
    await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })
  } catch (err) {
    return { error: `Timeout exceeded (${timeout}ms)` }
  }

  const buffer = await page.screenshot({ type: 'png', encoding: 'base64' })
  return { buffer }
}

/**
 * Dessine toutes les parcelles avec une parcelle en surbrillance
 * @param {Object} page - Page Puppeteer
 * @param {Array} parcelles - Tableau de toutes les parcelles
 * @param {Object} parcelleHighlight - Parcelle à mettre en surbrillance
 * @param {Object} options - Options de dessin
 * @returns {Promise<Object>} - Résultat avec buffer ou erreur
 */
async function drawParcelleHighlightOnMap (page, parcelles, parcelleHighlight, { width, height, center, zoom, timeout }) {
  await page.setViewport({ width, height })

  // @ts-ignore
  // eslint-disable-next-line no-undef
  const error = await page.evaluate(
    ({ parcelles, parcelleHighlight, center, zoom }) => {
      try {
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.jumpTo({ center, zoom })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        if (map.getSource('parcelles')) {
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeLayer('parcelles-highlight-layer')
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeLayer('parcelles-layer')
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeLayer('numeros-ilots')
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeSource('parcelles')
        }
        const autresParcelles = parcelles.filter(p => p.id !== parcelleHighlight.id)
        const autresFeatures = autresParcelles.map(parcelle => ({
          type: 'Feature',
          geometry: JSON.parse(parcelle.geojson),
          properties: { id: parcelle.id, highlight: false, NOM: parcelleHighlight.name, NUMERO_I: parcelleHighlight.nbilot, NUMERO_P: parcelleHighlight.nbp }
        }))
        const highlightFeature = {
          type: 'Feature',
          geometry: JSON.parse(parcelleHighlight.geojson),
          properties: { id: parcelleHighlight.id, highlight: true, NOM: parcelleHighlight.name, NUMERO_I: parcelleHighlight.nbilot, NUMERO_P: parcelleHighlight.nbp }
        }
        const allFeatures = [...autresFeatures, highlightFeature]
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addSource('parcelles', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: allFeatures
          }
        })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addLayer({
          id: 'parcelles-layer',
          type: 'fill',
          source: 'parcelles',
          filter: ['!', ['get', 'highlight']],
          paint: {
            'fill-color': 'rgba(240, 238, 237, 0.8)',
            'fill-outline-color': 'blue'
          }
        })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addLayer({
          id: 'parcelles-highlight-layer',
          type: 'fill',
          source: 'parcelles',
          filter: ['==', ['get', 'highlight'], true],
          paint: {
            'fill-color': 'rgba(99, 98, 183, 0.9)',
            'fill-outline-color': 'blue'
          }
        })
        return null
      } catch (err) {
        return `Erreur lors du rendu des parcelles : ${err.message}`
      }
    },
    { parcelles, parcelleHighlight, center, zoom }
  )
  if (error) return { error }

  try {
    await page.waitForSelector('body.loading', { hidden: true, timeout })
    // @ts-ignore
    // eslint-disable-next-line no-undef
    await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })
  } catch (err) {
    return { error: `Timeout exceeded (${timeout}ms)` }
  }

  const buffer = await page.screenshot({ type: 'png', encoding: 'base64' })
  return { buffer }
}

/**
 * Génère une image de carte pour un opérateur et ses parcelles
 * @param {any[]} parcelles - L'ID de l'enregistrement de l'opérateur
 * @param {Object} options - Options pour la génération des images
 * @returns {Promise<Object>} - Objet contenant les buffers des images générées
 */
async function generateOperatorMapImages (parcelles, tabs, options = {}) {
  try {
    const globalBbox = calculateGlobalBoundingBox(parcelles)

    // Paramètres par défaut
    const viewportWidth = options.width || 465
    const viewportHeight = options.height || 389
    const mapStyle = options.style || 'ofm-bright'
    const timeout = options.timeout || 30000

    const page = getPage(tabs, mapStyle)

    const globalZoom = getOptimalZoom(
      globalBbox.width,
      globalBbox.height,
      viewportWidth,
      viewportHeight
    )

    const globalResult = await drawAllParcellesOnMap(page, parcelles, {
      width: viewportWidth,
      height: viewportHeight,
      center: [globalBbox.centerx, globalBbox.centery],
      zoom: globalZoom,
      timeout
    })

    if (globalResult.error) {
      console.error(`Erreur lors de la génération de l'image globale: ${globalResult.error}`)
      return { global: null, parcelles: [] }
    }

    const parcelleImages = []

    for (const parcelle of parcelles) {
      const parcelleZoom = getOptimalZoom(
        parcelle.maxx - parcelle.minx,
        parcelle.maxy - parcelle.miny,
        viewportWidth,
        viewportHeight
      )

      const parcelleResult = await drawParcelleHighlightOnMap(page, parcelles, parcelle, {
        width: viewportWidth,
        height: viewportHeight,
        center: [parcelle.centerx, parcelle.centery],
        zoom: parcelleZoom,
        timeout
      })

      if (parcelleResult.error) {
        console.error(`Erreur lors de la génération de l'image pour la parcelle ${parcelle.id}: ${parcelleResult.error}`)
        continue
      }

      parcelleImages.push({
        id: parcelle.id,
        buffer: parcelleResult.buffer
      })
    }
    return {
      global: {
        buffer: globalResult.buffer
      },
      parcelles: parcelleImages
    }
  } catch (error) {
    console.error('Erreur dans generateOperatorMapImages:', error)
    return { global: null, parcelles: [] }
  }
}

async function generatePDF (numeroBio, recordId) {
  const dataCurrentOperator = await fetchOperatorByNumeroBio(numeroBio)
  const { rows } = await pool
    .query(/* sql */`SELECT version_name, audit_date, annee_reference_controle, mixite
        FROM cartobio_operators
        WHERE record_id = $1`,
    [recordId])

  const { metadata, ...record } = rows[0]

  const currentOperator = {
    ...dataCurrentOperator,
    metadata,
    ...record
  }
  const parcelles = await getAllParcelles(recordId)

  if (parcelles.length === 0) {
    console.error(`Aucune parcelle trouvée pour l'opérateur ${recordId}`)
    return { global: null, parcelles: [] }
  }

  const styles = await parseMapStyles()

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--headless',
      '--hide-scrollbars',
      '--mute-audio',
      '--use-gl=egl',
      '--disable-gpu',
      // WARNING : Peut-etre enlever en prod pour plus de sécurité
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  })

  const tabs = await Promise.all(styles.map(style => launchStyleTab(browser, style)))

  const result = await generateOperatorMapImages(parcelles, tabs)
  const page = await browser.newPage()
  const fontPath = path.join(__dirname, '../../image-map/Marianne.woff2')
  const fontData = fs.readFileSync(fontPath, { encoding: 'base64' })

  const groupedParcels = {}
  parcelles.forEach(parcel => {
    const conversionNiveau = parcel.conversion_niveau || 'Non défini'
    if (!groupedParcels[conversionNiveau]) {
      groupedParcels[conversionNiveau] = []
    }
    groupedParcels[conversionNiveau].push(parcel)
  })

  const order = ['AB', 'C3', 'C2', 'C1', 'CONV', 'Non défini']

  Object.keys(groupedParcels).forEach(niveau => {
    groupedParcels[niveau].sort((a, b) => {
      if (a.nbilot && a.nbp && b.nbilot && b.nbp) {
        return a.nbilot - b.nbilot || a.nbp - b.nbp
      }
      if (a.name && b.name) {
        return a.nom.localeCompare(b.name)
      }
      if (a.refcad && b.refcad) {
        return a.refcad.localeCompare(b.refcad)
      }
      return 0
    })
  })

  const sortedGroupedParcels = Object.fromEntries(
    Object.entries(groupedParcels).sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
    )
  )

  const groupTotals = {}
  let totalHA = 0
  Object.keys(sortedGroupedParcels).forEach(groupKey => {
    const groupSum = groupedParcels[groupKey].reduce(
      (sum, parcel) => sum + (parcel.superficie_totale_ha || 0),
      0
    )
    groupTotals[groupKey] = groupSum
    totalHA += groupSum
  })

  const blocksHTML = Object.keys(sortedGroupedParcels).map(groupKey =>
    sortedGroupedParcels[groupKey].map(item => {
      const parcelle = result.parcelles.find(e => e.id === item.id)
      const imgSrc = `data:image/png;base64,${parcelle.buffer}`
      const block = `
    <div class="block">
      <div class="container">
          <h3 class="header">${item.name ? 'Parcelle ' + item.name + ' - ' : ''}${item.nbilot ? 'Ilot ' + item.nbilot + ' parcelle ' + item.nbp : ''}${item.name == null && item.nbilot == null ? item.refcad : ''}</h3>
          <div class="info">
              <div class="info-block"><div class="title-grey">Commune (code commune) :</div> ${currentOperator.commune} (${currentOperator.codePostal})</div>
              <div class="info-block"><div class="title-grey">Date d'engagement :</div> ${item.engagement_date ? formatDate(item.engagement_date) : '-'}</div>
              <div class="info-block"><div class="title-grey">Niveau de conversion :</div> ${item.conversion_niveau === 'CONV' ? 'Conventionnel' : item.conversion_niveau || '-'}</div>
          </div>
          <div class="table-container">
              <table>
                  <tr>
                      <th class="row1">Culture</th>
                      <th class="row2">Variété de culture</th>
                      <th class="row3">Date de semis</th>
                      <th class="row4">Surface</th>
                  </tr>
                  ${item.cultures.map(e => {
                    return `
                     <tr>
                      <td>${fromCodeCpf(e.CPF).libelle_code_cpf}</td>
                      <td>${e.variete ? e.variete : '-'}</td>
                      <td>${e.date_semis ? formatDate(e.date_semis) : '-'}</td>
                      <td>${item.cultures.length === 1 ? item.superficie_totale_ha.toFixed(2).replace('.', ',') + ' ha' : e.surface ? Number(e.surface).toFixed(2).replace('.', ',') + ' ha' : '-'} </td>
                    </tr>
                    `
                  }
                  ).join('')}
              </table>
          </div>
          <div>
              <h3 class="certification">Notes de certification</h3>
              <p class='notes'>${item.auditeur_notes ? item.auditeur_notes : '-'}</p>
          </div>
      </div>
      <div class="map-container">
        <img src="${imgSrc}" alt="Carte de la parcelle" />
        <div class="data-global">
          <div class="title-surface">Surface graphique de la parcelle</div>
          <div class="align-left">${item.superficie_totale_ha.toFixed(2).replace('.', ',')} ha</div>
        </div>
      </div>
    </div>`
      return block
    })
      .join(''))

  const finalHTML = parcelles.length % 2 !== 0
    ? blocksHTML + '</div>'
    : blocksHTML

  const content = `
    <!doctypehtml>
    <html lang=fr>
    <head>
    <meta charset=UTF-8>
    <title>PDF Dynamique</title>
    <style>body{margin:0;padding:0}
    .title-surface{color:#cecece;text-align:left;}
    .data-global{text-align:center;background-color:#000091;padding:10px;font-size:12px;width:70%;margin-left:12.5%}
    .align-left{text-align:left;margin-top:2px;color:rgba(245,245,254,1)}
    .title-grey{text-align:left;color:#777777}
    .block{display:grid;grid-template-columns:65% 35%;page-break-inside:avoid;break-inside:avoid;margin-bottom:20px;gap:40px}
    // .page{page-break-after:always;display:flex;flex-direction:column}.page:last-child{page-break-after:auto}
    .header{font-size:20px;font-weight:700;margin-bottom:10px;}.container{padding:10px}.info{font-size:13px;display:flex;margin-bottom:20px;margin-top:20px;justify-content:space-between}
    .info-block{flex:1}
    .table-container{margin-top:20px;margin-bottom:20px}
    table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;border:none}
    td,th{padding:8px;text-align:left;border-bottom:.5px solid #e3e3e3}
    td { font-weight: lighter;}
    th{background-color:#000091;color:#fff}.certification{margin-top:5px;color:#777777;font-size:12px}
    .notes{font-size:12px}.map-container{margin-top:20px;text-align:center;}
    .map-container img{max-width:75%}
    @media print{.page{height:auto;min-height:auto}}
    .row1{width:25%}.row2{width:50%}.row3{width:15%}.row4{width:10%}
    </style>
    </head>
    <body>
    ${finalHTML}
    </body>
    </html>`
  await page.setContent(content)
  await page.evaluate((fontData) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    const style = document.createElement('style')
    style.innerHTML = `
      @font-face {
        font-family: 'Marianne';
        src: url(data:font/woff2;base64,${fontData}) format('woff2');
        font-style: normal;
      }
    `
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.head.appendChild(style)
  }, fontData)

  await page.evaluate(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('body').style.fontFamily = 'Marianne, sans-serif'
  })
  await page.pdf({
    path: `${numeroBio}-${recordId}-2.pdf`,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: {
      top: '1cm',
      right: '1cm',
      bottom: '1cm',
      left: '1cm'
    }
  })

  const resumeHTML = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <style>
      .container {
        max-width: 1200px;
        background-color: #fff;
      }
        .container-bottom {
        max-width: 1200px;
        margin-top : 40px;
        background-color: #fff;
      }

      header {
        margin-bottom: 30px;
      }

      .header-top {
        display: flex;
        align-items: center;
        gap: 20px;
      }

      .header-top h1 {
        font-size: 24px;
        font-weight: 700;
        color: #2b3a75;
      }

      .badge {
        background-color: #e5fbfd;
        border-radius: 4px;
        width: fit-content;
        border: 1px solid #4cb4bd;
        padding: 2px 3px;
        color: #006a6f;
        font-weight: 600;
        font-size: 12px;
        padding: auto;
        display: flex;
        margin-left: 0px;
        margin-top: 10px;
      }

      .badge svg {
        margin: auto;
        display: block;
      }

      .top-info {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 20px;
      }

      .top-info .left {
        padding-left: 0px;
        flex: 1 75%;
      }

      .top-info .left p {
        margin-bottom: 6px;
        font-size: 13px;
        line-height: 1.5;
        margin-left: 0px;
      }

      .table-section {
        margin-top: 10px;
      }

      .table-section h3 {
        font-size: 14px;
        margin-bottom: 15px;
        font-weight: 600;
        color: #2b3a75;
      }

      h3 {
        font-size: 14px;
        margin-bottom: 10px;
      }
      table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        margin-bottom: 20px;
        font-size: 12px !important;
        border-spacing: 0;
        min-width: 100%;
        max-width: 100%;
      }

      th,
      td {
        padding: 8px;
        text-align: left;
        border-bottom: 0.5px solid #e3e3e3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-sizing: border-box;
      }

      td {
        font-weight: lighter;
      }

      .row1 { width: 15%; }
      .row2 { width: 14%; }
      .row3 { width: 22%; }
      .row4 { width: 14%; }
      .row5 { width: 16%; }
      .row6 { width: 12%; }
      .row7 { width: 8%; }

      th {
        background-color: #000091;
        color: white;
        font-weight: bold !important;
      }
      .last-line {
        background-color: #000091;
        opacity: 0.5;
        color: white;
        font-weight: bold !important;
        border: none !important;
      }

      .last-line td {
        font-weight: bold !important;
      }

      .group-total {
        background-color: #f7f7f7;
        font-weight: bold;
      }
      .group-total td {
        font-weight: bold;
      }
      .text-right {
        text-align: right;
      }

      .ligne-header {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        margin-left: 0px;
        justify-content: space-between;
        width: 60%;
        gap: 5px;
      }
      .ligne-header > p {
        display: flex;
        flex-direction: column;
      }
      .title-header {
        font-style: normal;
        font-weight: 400;
        font-size: 14px;
        color: #777777;
      }
      .header-container {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header-left {
        flex: 1;
      }

      header {
        position: relative;
      }

      .header-right {
        position: absolute;
        top: 0;
        left: 65%;
        max-width: 700px;
      }

      .header-right img {
        width: 100%;
        max-width: 678px;
        object-fit: contain;
      }
      .title-tableau {
        font-size: 16px;
      }

      .global-ligne {
        font-weight: lighter;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <div class="header-left">
          <div class="header-top">
            <h1 class="name-operator">${currentOperator.nom}</h1>
            <div class="badge">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clip-path="url(#clip0_2361_8449)">
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M6.00023 0.500122C7.69869 0.500122 9.21196 1.57275 9.77448 3.17536C10.337 4.77797 9.82609 6.56108 8.50023 7.62262V11.0581C8.50024 11.1482 8.45183 11.2313 8.37349 11.2757C8.29514 11.3201 8.19897 11.3189 8.12173 11.2726L6.00023 9.99962L3.87873 11.2726C3.8014 11.319 3.70513 11.3201 3.62675 11.2756C3.54837 11.231 3.50003 11.1478 3.50023 11.0576V7.62262C2.17436 6.56108 1.66345 4.77797 2.22597 3.17536C2.78849 1.57275 4.30176 0.500122 6.00023 0.500122ZM7.50023 8.20862C7.02365 8.40137 6.51431 8.50018 6.00023 8.49962C5.48615 8.50018 4.9768 8.40137 4.50023 8.20862V9.73362L6.00023 8.83362L7.50023 9.73362V8.20862ZM6.00023 1.49962C4.34337 1.49962 3.00023 2.84277 3.00023 4.49962C3.00023 6.15648 4.34337 7.49962 6.00023 7.49962C7.65708 7.49962 9.00023 6.15648 9.00023 4.49962C9.00023 2.84277 7.65708 1.49962 6.00023 1.49962Z"
                    fill="#006A6F"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2361_8449">
                    <rect
                      width="12"
                      height="12"
                      fill="white"
                      transform="translate(0 -0.000366211)"
                    />
                  </clipPath>
                </defs>
              </svg>
              <div>CERTIFIÉ | ${currentOperator.annee_reference_controle}</div>
            </div>
          </div>
        </div>
        <div class="header-right">
          <img
            src="data:image/png;base64,${result.global.buffer}"
            alt="Carte des parcelles"
          />
        </div>
      </header>

      <div class="top-info">
        <div class="left">
          <div class="ligne-header">
            <p>
              <span class="title-header">Siret&nbsp;:</span>
              ${currentOperator.siret}
            </p>
            <p>
              <span class="title-header">Numéro pacage&nbsp;:</span>
              ${currentOperator.numeroPacage ? currentOperator.numeroPacage : '-'}
            </p>
            <p>
              <span class="title-header">Adresse&nbsp;:</span>
              ${currentOperator.adressesOperateurs[0].lieu ?? '-'}
              <br/>
              ${currentOperator.adressesOperateurs[0].codePostal ?? '-'}
              ${currentOperator.adressesOperateurs[0].ville ?? '-'}
            </p>
          </div>
          <div class="ligne-header">
            <p>
              <span class="title-header">Année réf. contrôle&nbsp;:</span>
              ${currentOperator.annee_reference_controle}
            </p>
            <p>
              <span class="title-header">Certifié par&nbsp;:</span>
              ${currentOperator.organismeCertificateur.nom}
            </p>
            <p>
              <span class="title-header">Date d'audit&nbsp;:</span>
              ${currentOperator.audit_date ? formatDate(currentOperator.audit_date) : '-'}
            </p>
          </div>
          <div class="ligne-header">
            <p>
              <span class="title-header">Mixité&nbsp;:</span> ${
              currentOperator.mixite === 'AB' ? '100% AB' : currentOperator.mixite === 'ABCONV' ? 'AB/En conversion' : currentOperator.mixite === 'MIXTE' ? 'Mixte' : '-'}
            </p>
            <p>
              <span class="title-header">Nombre de parcelles&nbsp;:</span
              >${parcelles.length || '-'}
            </p>
            <p>
              <span class="title-header">Surface totale&nbsp;:</span
              >${totalHA.toFixed(2).replace('.', ',') + ' ha' || '-'}
            </p>
          </div>
        </div>
      </div>

      <div class="container-bottom">
        <h3 class="title-tableau">Tableau récapitulatif des parcelles</h3>
        <table>
          <thead>
            <tr>
              <th class="row1">Nom de la parcelle</th>
              <th class="row2">Ref. PAC / cadastre</th>
              <th class="row3">Culture(s)</th>
              <th class="row4">Date d'engagement</th>
              <th class="row5">Niveau de conversion</th>
              <th class="row6">Code commune</th>
              <th class="text-right row7">Surface</th>
            </tr>
          </thead>
          <tbody>
            ${Object.keys(sortedGroupedParcels).map(groupKey => `
            ${sortedGroupedParcels[groupKey].map(parcel => `
            <tr class="global-ligne">
              <td>${parcel.name || '-'}</td>
              <td>
                ${parcel.nbilot ? `Ilot ${parcel.nbilot || '-'} - Parcelle ${parcel.nbp || ''}` : parcel.refcad ? parcel.refcad : '-'}
              </td>
              <td>
                ${(parcel.cultures || []).map(c =>
                fromCodeCpf(c.CPF).libelle_code_cpf).join(', ') || ''}
              </td>
              <td>
                ${parcel.conversion_date ? formatDate(parcel.conversion_date) : '-'}
              </td>
              <td>
                ${parcel.conversion_niveau === 'CONV' ? 'Conventionnel' : parcel.conversion_niveau || '-'}
              </td>
              <td>${parcel.commune || '-'}</td>
              <td class="text-right">
                ${(parcel.superficie_totale_ha || 0).toFixed(2).replace('.',
                ',')} ha
              </td>
            </tr>
            `).join('')}
            <tr class="group-total">
              <td colspan="4">
                Niveau de conversion ${groupKey === 'CONV' ? 'conventionnel' : groupKey}
              </td>
              <td class="text-right" colspan="2">Surface totale :</td>
              <td class="text-right">
                ${groupTotals[groupKey].toFixed(2).replace('.', ',')} ha
              </td>
            </tr>
            `).join('')}
            <tr class="last-line">
              <td class="text-right" colspan="6">
                Surface totale de l'exploitation :
              </td>
              <td class="text-right">
                ${totalHA.toFixed(2).replace('.', ',')} ha
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </body>
</html>
`
  await page.setContent(resumeHTML)
  await page.evaluate((fontData) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    const style = document.createElement('style')
    style.innerHTML = `
      @font-face {
        font-family: 'Marianne';
        src: url(data:font/woff2;base64,${fontData}) format('woff2');
        font-weight: normal;
        font-style: normal;
      }
    `
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.head.appendChild(style)
  }, fontData)

  await page.evaluate(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('body').style.fontFamily = 'Marianne, sans-serif'
  })
  await page.pdf({
    path: `${numeroBio}-${recordId}-1.pdf`,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: {
      top: '1cm',
      right: '1cm',
      bottom: '1cm',
      left: '1cm'
    },
    preferCSSPageSize: true
  })

  await page.close()

  // Page de garde

  const page2 = await browser.newPage()
  const htmlPath = path.join(__dirname, '../../image-map/gardepage.html')
  let htmlContent = fs.readFileSync(htmlPath, 'utf8')

  htmlContent = htmlContent.replace(/src="([^"]+)"/g, (match, src) => {
    if (!src.startsWith('http') && !src.startsWith('data:')) {
      const imagePath = path.join(__dirname, '../../image-map', src)
      return `src="${imageToBase64(imagePath)}"`
    }
    return match
  })
  await page2.setContent(htmlContent, {
    waitUntil: 'networkidle0'
  })
  await page2.evaluate((currentOperator) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('#siretnumber').textContent = currentOperator.siret
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('#numeropacage').textContent = currentOperator.numeroPacage ? currentOperator.numeroPacage : '-'
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('#nomog').textContent = currentOperator.nom
  }, currentOperator)
  await page2.evaluate((fontData) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    const style = document.createElement('style')
    style.innerHTML = `
      @font-face {
        font-family: 'Marianne';
        src: url(data:font/woff2;base64,${fontData}) format('woff2');
        font-weight: normal;
        font-style: normal;
      }
    `
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.head.appendChild(style)
  }, fontData)
  await page2.evaluate(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('body').style.fontFamily = 'Marianne, sans-serif'
  })

  await page2.setViewport({
    width: 1754,
    height: 1240,
    deviceScaleFactor: 2
  })
  await page2.pdf({
    path: `${numeroBio}-${recordId}-0.pdf`,
    format: 'A4',
    landscape: true,
    printBackground: true,
    pageRanges: '1',
    scale: 0.65,
    margin: {
      top: '0cm',
      right: '0cm',
      bottom: '0cm',
      left: '0cm'
    }
  })

  await page2.close()

  const pdfFiles = [`${numeroBio}-${recordId}-0.pdf`, `${numeroBio}-${recordId}-1.pdf`, `${numeroBio}-${recordId}-2.pdf`]

  const pdf = await mergeAndAddFooter(pdfFiles, currentOperator.nom)
  await browser.close()
  return pdf
}

async function mergeAndAddFooter (pdfPaths, name) {
  const mergedPdf = await pdflib.PDFDocument.create()
  const copiedPages = []

  for (const [docIndex, pdfPath] of pdfPaths.entries()) {
    const pdfBytes = fs.readFileSync(pdfPath)
    // @ts-ignore Dans la doc, c'est normal
    // eslint-disable-next-line no-undef
    const pdf = await pdflib.PDFDocument.load(pdfBytes)
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())

    pages.forEach((page) => {
      copiedPages.push({ page, docIndex })
      mergedPdf.addPage(page)
    })
  }

  copiedPages.forEach(({ page }, index) => {
    if (index > 0) {
      const { width } = page.getSize()
      const fontSize = 9
      const text = `${index + 1}`

      page.drawText(text, {
        x: width - 38,
        y: 20,
        size: fontSize
      })

      page.drawText(name, {
        x: 38,
        y: 20,
        size: fontSize
      })
    }
  })

  const mergedPdfBytes = await mergedPdf.saveAsBase64()

  pdfPaths.forEach((path) => fs.unlinkSync(path))
  return mergedPdfBytes
}

function imageToBase64 (imagePath) {
  try {
    const ext = path.extname(imagePath).substring(1)
    const data = fs.readFileSync(imagePath).toString('base64')
    return `data:image/${ext};base64,${data}`
  } catch (error) {
    console.error(`Erreur chargement image ${imagePath}:`, error)
    return ''
  }
}

function formatDate (dateStr) {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
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
  generateOperatorMapImages,
  generatePDF,
  ...(process.env.NODE_ENV === 'test' ? { evvClient } : {})
}
