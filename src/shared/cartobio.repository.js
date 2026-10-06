'use strict'

const { polygon } = require('@turf/helpers')
// @ts-ignore
// @ts-ignore
// @ts-ignore

const pool = require('../database/database.js')
const { CertificationState, EventType } = require('./enums')
const { fetchEmailForNumeroBio } = require('../clients/agence-bio.client.js')
// @ts-ignore
const { createNewEvent } = require('./outputs/history.js')
const { InvalidRequestApiError } = require('./errors.js')
const { getRandomFeatureId, populateWithMultipleCultures } = require('./outputs/features.js')
// @ts-ignore
const { sendCertificationComplete } = require('../services/mailer/utils.js')
/** TMP */
// const bboxPolygon = require('@turf/bbox-polygon').default
// const polygonInPolygon = require('@turf/boolean-intersects').default


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
 * @typedef {import('./outputs/types/api').InputApiRecord} InputApiRecord
 * @typedef {import('./outputs/types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('./outputs/types/features').CartoBioFeatureCollection} CartoBioFeatureCollection
 * @typedef {import('./outputs/types/features').CartoBioFeatureProperties} CartoBioFeatureProperties
 * @typedef {import('./outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./outputs/types/record').NormalizedRecordSummary} NormalizedRecordSummary
 * @typedef {import('./outputs/types/history').HistoryEntry} HistoryEntry
 * @typedef {import('./outputs/types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('./outputs/types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */


const recordFields = /* sqlFragment */`cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite`

/**
 * Create a new record unless we find a dangling one with the same numeroBio and audit date, in which case we update it
 * with the merge algorithm described in ../../docs/rfc/[001-api-parcellaire.md](http://001-api-parcellaire.md)
 *
 * @param {Partial<NormalizedRecord>} record
 * @param {Object} [context]
 * @param {CartoBioUser} [context.user]
 * @param {Boolean} [context.copyParcellesData]
 * @param {String} [context.previousRecordId]
 * @param {Boolean} [context.fromAPI]
 * @param {import('pg').PoolClient} [customClient]
 * @returns {Promise<DBOperatorRecordWithParcelles>}
 */
async function createOrUpdateOperatorRecord (record, context = {}, customClient) {
  const certificationState =
    record.certification_state || CertificationState.OPERATOR_DRAFT

  const client = customClient || await pool.connect()

  try {
    let preparedFeatures = await prepareFeatures(record.parcelles.features)

    const previousMap = await loadPreviousFullData(
      client,
      context,
      record.numerobio ? record.numerobio : '',
      preparedFeatures
    )

    preparedFeatures = applyPreviousData(
      preparedFeatures,
      previousMap,
      context
    )

    /** @type {HistoryEntry} */
    const historyEntry = createNewEvent(
      EventType.FEATURE_COLLECTION_CREATE,
      {
        features: preparedFeatures,
        state: certificationState,
        metadata: record.metadata,
        date: new Date()
      },
      { user: context?.user, record: null }
    )

    const isNewParcellaire = record.audit_date && record.audit_date !== ''
      ? await client.query(`
      SELECT certification_state
      FROM cartobio_operators
      WHERE numerobio = $1
        AND audit_date = $2
        AND deleted_at IS NULL
    `, [record.numerobio, record.audit_date])
      : { rowCount: 0, rows: [] }

    await client.query('BEGIN')

    const operatorResult = await upsertOperator(
      client,
      record,
      certificationState,
      historyEntry
    )

    const operator = operatorResult.rows[0]
    const recordId = operator.record_id

    if (operator.certification_state === CertificationState.CERTIFIED) {
      if (!operator.certification_date_debut || !operator.certification_date_fin) {
        throw new InvalidRequestApiError('Les dates de certification sont manquantes.')
      }
    }

    const parcelles = await upsertParcelles(client, recordId, preparedFeatures)

    await deleteMissingParcelles(client, recordId, parcelles)

    if (context?.copyParcellesData && context?.previousRecordId) {
      const addedParcelles = await client.query(
        /* sql */`
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, auditeur_notes,
            name, reference_cadastre, code_culture_pac, code_precision_pac)
          (
                SELECT $1, id, geometry, commune, cultures, conversion_niveau, engagement_date, NULL as auditeur_notes,
                    name, reference_cadastre, code_culture_pac, code_precision_pac
                FROM cartobio_operators co
                CROSS JOIN jsonb_to_recordset(co.audit_history)
                    AS x("featureIds" text, type text, state text, date text)
                LEFT JOIN cartobio_parcelles ON co.record_id = cartobio_parcelles.record_id
                WHERE
                    type = 'FeatureCollectionCreation'
                    AND state = 'OPERATOR_DRAFT'
                    AND NOT "featureIds" ~ id
                    AND NOT EXISTS (
                      SELECT 1 FROM cartobio_parcelles cp_base
                      WHERE cp_base.record_id = $1
                      AND ST_Intersects(cp_base.geometry, cartobio_parcelles.geometry)
                      AND (
                          ST_Area(ST_Intersection(cp_base.geometry, cartobio_parcelles.geometry)) / ST_Area(cp_base.geometry) > 0.5
                          OR
                          ST_Area(ST_Intersection(cp_base.geometry, cartobio_parcelles.geometry)) / ST_Area(cartobio_parcelles.geometry) > 0.5
                        )
                      AND cp_base.deleted_at IS NULL
                    )
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
        [recordId, operator.numerobio, context.previousRecordId]
      )
      parcelles.push(...addedParcelles.rows)
    }

    if (record.certification_state === 'CERTIFIED') {
      await updateMixite(client, recordId)
    }

    await client.query('COMMIT;')

    if ((isNewParcellaire.rowCount === 0 || isNewParcellaire.rows[0].certification_state !== CertificationState.CERTIFIED) && record.certification_state === CertificationState.CERTIFIED) {
      try {
        const emails = await fetchEmailForNumeroBio(operator.numerobio)
        for (const utilisateur of emails.utilisateurs) {
          await sendCertificationComplete(operator, utilisateur.email)
        }
        await client.query(
        /* sql */`
          UPDATE cartobio_operators
          SET date_derniere_notif = NOW()
          WHERE record_id = $1
        `,
          [operator.record_id])
      } catch (error) {
        console.error(`Erreur lors de l'envoi de la notification de certification pour le record ${operator.record_id}`)
        console.error(error)
      }
    }
    return { ...operator, parcelles }
  } catch (e) {
    await client.query('ROLLBACK')
    // @ts-ignore
    if (e.code === '23502') {
      throw new InvalidRequestApiError('La donnée géographique est manquante ou invalide.')
    }

    throw e
  } finally {
    if (!customClient) client.release()
  }
}

/**
 * Load the parcelles of a previous record to allow data copy across records
 *
 * @param {import('pg').PoolClient} client
 * @param {Object} context
 * @param {Boolean} [context.copyParcellesData]
 * @param {String} [context.previousRecordId]
 * @param {String} numerobio
 * @param {Array<any>} features
 * @returns {Promise<Map<String, DBParcelle>>}
 */
async function loadPreviousFullData (client, context, numerobio, features) {
  if (!context?.copyParcellesData || !context?.previousRecordId) {
    return new Map()
  }

  const previousMap = new Map()

  for (const feature of features) {
    if (!feature.id || !feature.geometry) continue

    const { rows } = await client.query(
      `
      SELECT
        cp.id,
        cp.cultures,
        cp.conversion_niveau,
        cp.engagement_date,
        cp.name
      FROM cartobio_parcelles cp
      JOIN cartobio_operators co ON co.record_id = cp.record_id
      WHERE co.numerobio = $1
        AND co.record_id = $2
        AND co.deleted_at IS NULL
        AND cp.deleted_at IS NULL
        AND ST_area(
          ST_Intersection(
            ST_MakeValid(cp.geometry),
            ST_MakeValid(ST_SetSRID($3::geometry, 4326))
          )
        ) / (ST_area(ST_MakeValid(cp.geometry)) / 100) > 99
        AND ST_area(
          ST_Intersection(
            ST_MakeValid(cp.geometry),
            ST_MakeValid(ST_SetSRID($3::geometry, 4326))
          )
        ) / (ST_area(ST_MakeValid(ST_SetSRID($3::geometry, 4326))) / 100) > 99
      ORDER BY cp.created DESC
      LIMIT 1
      `,
      [numerobio, context.previousRecordId, feature.geometry]
    )

    if (rows.length) {
      previousMap.set(feature.id, rows[0])
    }
  }

  return previousMap
}

/**
 * Normalize, validate and enrich a list of GeoJSON features before database insertion:
 * - populates multiple cultures
 * - fixes invalid geometries
 * - resolves commune code
 * - flags features as foreign (hors France)
 *
 * @param {Array<any>} features
 * @returns {Promise<Array<any>>}
 */
async function prepareFeatures (features) {
  const sorted = [...features]

  return await Promise.all(sorted.map(async (feature) => {
    if (!feature.id) {
      feature = { ...feature, id: getRandomFeatureId() }
    }
    feature = populateWithMultipleCultures(feature)
    if (feature.geometry) {
      const fixResult = await fixGeometry(feature.geometry)
      const id = feature.id
      const featureLabel = feature.properties.NUMERO_I && feature.properties.NUMERO_P
        ? `îlot ${feature.properties.NUMERO_I} parcelle ${feature.properties.NUMERO_P}`
        : feature.properties.NOM || feature.id

      if (fixResult.statut === 'UNCORRECTABLE') {
        throw new InvalidRequestApiError(`Une géométrie n'est pas corrigeable (${featureLabel})`)
      }

      if (fixResult.statut === 'CORRIGE') {
        feature = polygon(
          fixResult.geometry.coordinates,
          feature.properties,
          { id }
        )
      }

      feature.properties.statut_import_geom =
      fixResult.statut === 'CORRIGE'
        ? 'CORRIGE'
        : fixResult.statut === 'ACCEPTENONCORRIGE'
          ? 'ACCEPTENONCORRIGE'
          : 'ACCEPTE'

      const etranger = await isEtranger(feature.geometry)
      feature.properties.etranger = etranger

      if (etranger) {
        feature.properties.COMMUNE = null
      } else {
        const valid =
        feature.properties.COMMUNE &&
        await communeExists(feature.geometry, feature.properties.COMMUNE)
        feature.properties.COMMUNE = valid
          ? feature.properties.COMMUNE
          : await findCommune(feature.geometry, feature.properties.COMMUNE)
      }
    }
    return feature
  }))
}

/**
 * Merge data from a previous record into the prepared features (conversion_niveau, engagement_date, NOM, cultures)
 * No-op if context.copyParcellesData is falsy
 *
 * @param {Array<any>} features
 * @param {Map<String, DBParcelle>} previousMap
 * @param {Object} context
 * @param {Boolean} [context.copyParcellesData]
 * @returns {Array<any>}
 */
function applyPreviousData (features, previousMap, context) {
  if (!context?.copyParcellesData) return features

  return features.map(f => {
    const prev = previousMap.get(f.id)
    if (!prev) return f

    const newCultures = f.properties.cultures || []
    const oldCultures = prev.cultures || []

    return {
      ...f,
      properties: {
        ...f.properties,

        cultures: mergeCulturesExact(newCultures, oldCultures),

        conversion_niveau:
          f.properties.conversion_niveau === 'AB?'
            ? prev.conversion_niveau
            : f.properties.conversion_niveau || prev.conversion_niveau,

        engagement_date:
          f.properties.engagement_date || prev.engagement_date,

        NOM:
          f.properties.NOM || prev.name
      }
    }
  })
}

/**
 * Merge cultures from a previous record into new cultures, preserving varietes by CPF match
 *
 * @param {Array<import('./outputs/types/features').CartoBioCulture>} newCultures
 * @param {Array<import('./outputs/types/features').CartoBioCulture>} oldCultures
 * @returns {Array<import('./outputs/types/features').CartoBioCulture>}
 */
function mergeCulturesExact (newCultures = [], oldCultures = []) {
  const map = new Map()

  for (const newC of newCultures) {
    const cpf = newC.CPF

    const varietes = oldCultures
      .filter(o => o.CPF === cpf && o.variete)
      .map(o => o.variete)

    if (varietes.length) {
      map.set(cpf, Array.from(new Set(varietes)).join('; '))
    }
  }

  return newCultures.map(c => ({
    ...c,
    variete: c.variete || map.get(c.CPF) || ''
  }))
}
/**
 * Insert or update a cartobio_operators row
 *
 * @param {import('pg').PoolClient} client
 * @param {Partial<NormalizedRecord>} record
 * @param {CertificationState} certificationState
 * @param {HistoryEntry} historyEntry
 * @returns {Promise<import('pg').QueryResult>}
 */
async function upsertOperator (client, record, certificationState, historyEntry) {
  return await client.query(
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
                     (cartobio_operators.audit_history || coalesce($9::jsonb, '[]'::jsonb)),
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
}

/**
 * Insert or update cartobio_parcelles rows for a given record.
 * Features without geometry are handled as partial updates (non-geo columns only).
 * Throws if a geometry-less feature does not already exist in the database.
 *
 * @param {import('pg').PoolClient} client
 * @param {String} recordId
 * @param {Array<any>} features
 * @returns {Promise<Array<DBParcelle>>}
 */
async function upsertParcelles (client, recordId, features) {
  const parcelles = []
  for (const feature of features) {
    if (!feature.geometry) {
      const { rows: partialUpdateRows } = await client.query(
        /* sql */`
          UPDATE cartobio_parcelles
          SET (commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes,
               annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac,
               reference_cadastre, code_culture_pac, code_precision_pac, etranger, statut_import_geom, attente_pac) =
              (coalesce($3, cartobio_parcelles.commune),
               coalesce($4, cartobio_parcelles.cultures),
               coalesce($5, cartobio_parcelles.conversion_niveau),
               nullif(coalesce($6::text, cartobio_parcelles.engagement_date::text), '')::date,
               coalesce($7, cartobio_parcelles.commentaire),
               coalesce($8, cartobio_parcelles.auditeur_notes),
               coalesce($9, cartobio_parcelles.annotations),
               now(),
               coalesce($10, cartobio_parcelles.name),
               coalesce($11, cartobio_parcelles.numero_pacage),
               coalesce($12, cartobio_parcelles.numero_ilot_pac),
               coalesce($13, cartobio_parcelles.numero_parcelle_pac),
               coalesce($14, cartobio_parcelles.reference_cadastre),
               coalesce($15, cartobio_parcelles.code_culture_pac),
               coalesce($16, cartobio_parcelles.code_precision_pac),
               coalesce($17, cartobio_parcelles.etranger),
               coalesce($18, cartobio_parcelles.statut_import_geom),
               coalesce($19, cartobio_parcelles.attente_pac))
          WHERE record_id = $1 AND id = $2
          RETURNING *, ST_AsGeoJSON(geometry)::json AS geometry
        `,
        [
          /*  $1 */ recordId,
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
          /* $16 */ feature.properties.CODE_VAR,
          /* $17 */ feature.properties.etranger ?? false,
          /* $18 */ feature.properties.statut_import_geom || 'ACCEPTE',
          /* $19 */ feature.properties.en_attente_pac || false
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
        INSERT INTO cartobio_parcelles
        (
          record_id,
          id,
          geometry,
          commune,
          cultures,
          conversion_niveau,
          engagement_date,
          commentaire,
          auditeur_notes,
          annotations,
          created,
          updated,
          name,
          numero_pacage,
          numero_ilot_pac,
          numero_parcelle_pac,
          reference_cadastre,
          code_culture_pac,
          code_precision_pac,
          etranger,
          statut_import_geom,
          attente_pac
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          COALESCE($5::jsonb, '[]'::jsonb),
          $6,
          NULLIF($7::text, '')::date,
          $8,
          $9,
          COALESCE($10::jsonb, '[]'::jsonb),
          now(),
          now(),
          NULLIF($11, ''),
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20
        )
        ON CONFLICT (record_id, id)
        DO UPDATE SET
          geometry = COALESCE($3, cartobio_parcelles.geometry),
          commune = COALESCE($4, cartobio_parcelles.commune),
          cultures = COALESCE($5::jsonb, cartobio_parcelles.cultures),
          conversion_niveau = COALESCE($6, cartobio_parcelles.conversion_niveau),
          engagement_date = nullif(coalesce($7::text, cartobio_parcelles.engagement_date::text), '')::date,
          commentaire = COALESCE($8, cartobio_parcelles.commentaire),
          auditeur_notes = COALESCE($9, cartobio_parcelles.auditeur_notes),
          annotations = COALESCE($10::jsonb, cartobio_parcelles.annotations),
          updated = now(),
          name = COALESCE($11, cartobio_parcelles.name),
          numero_pacage = COALESCE($12, cartobio_parcelles.numero_pacage),
          numero_ilot_pac = COALESCE($13, cartobio_parcelles.numero_ilot_pac),
          numero_parcelle_pac = COALESCE($14, cartobio_parcelles.numero_parcelle_pac),
          reference_cadastre = COALESCE($15, cartobio_parcelles.reference_cadastre),
          code_culture_pac = COALESCE($16, cartobio_parcelles.code_culture_pac),
          code_precision_pac = COALESCE($17, cartobio_parcelles.code_precision_pac),
          etranger = COALESCE($18, cartobio_parcelles.etranger),
          statut_import_geom = COALESCE($19, cartobio_parcelles.statut_import_geom),
          attente_pac = COALESCE($20, cartobio_parcelles.attente_pac)

        RETURNING *,
          ST_AsGeoJSON(geometry)::json AS geometry
      `,
      [
        /* $1  */ recordId,
        /* $2  */ feature.id || getRandomFeatureId(),
        /* $3  */ feature.geometry,
        /* $4  */ feature.properties.COMMUNE,
        /* $5  */ feature.properties.cultures ? JSON.stringify(feature.properties.cultures) : null,
        /* $6  */ feature.properties.conversion_niveau,
        /* $7  */ feature.properties.engagement_date,
        /* $8  */ feature.properties.commentaires,
        /* $9  */ feature.properties.auditeur_notes,
        /* $10 */ feature.properties.annotations ? JSON.stringify(feature.properties.annotations) : null,
        /* $11 */ feature.properties.NOM,
        /* $12 */ feature.properties.PACAGE,
        /* $13 */ feature.properties.NUMERO_I,
        /* $14 */ feature.properties.NUMERO_P,
        /* $15 */ feature.properties.cadastre,
        /* $16 */ feature.properties.TYPE,
        /* $17 */ feature.properties.CODE_VAR,
        /* $18 */ feature.properties.etranger ?? false,
        /* $19 */ feature.properties.statut_import_geom || 'ACCEPTE',
        /* $20 */ feature.properties.en_attente_pac ?? false

      ]
    )
    if (rows.at(0)) {
      parcelles.push(rows.at(0))
    }
  }

  return parcelles
}

/**
 * Delete parcelles of a record that are no longer present in the new feature collection
 *
 * @param {import('pg').PoolClient} client
 * @param {String} recordId
 * @param {Array<DBParcelle>} parcelles
 * @returns {Promise<void>}
 */
async function deleteMissingParcelles (client, recordId, parcelles) {
  await client.query(
    `
    DELETE FROM cartobio_parcelles
    WHERE record_id = $1
    AND id != ALL($2)
    `,
    [recordId, parcelles.map(p => p.id)]
  )
}

/**
 * Recompute and update the mixite field of a cartobio_operators row
 * based on the conversion_niveau of its parcelles
 *
 * @param {import('pg').PoolClient} client
 * @param {String} recordId
 * @returns {Promise<void>}
 */
async function updateMixite (client, recordId) {
  await client.query(
    `
    UPDATE cartobio_operators co
    SET mixite = sub.mixite
    FROM (
      SELECT
        co.record_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE cp.conversion_niveau = 'AB') = COUNT(*)
            THEN 'AB'
          WHEN COUNT(*) FILTER (WHERE cp.conversion_niveau IN ('C1','C2','C3','AB')) = COUNT(*)
            THEN 'ABCONV'
          WHEN COUNT(*) FILTER (WHERE cp.conversion_niveau = 'CONV') > 0
            THEN 'MIXTE'
          ELSE NULL
        END AS mixite
      FROM cartobio_operators co
      LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
      WHERE co.record_id = $1 and NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(cp.cultures) AS elem
        WHERE elem->>'CPF' IN ('01.99.10.1', '01.99.10.2'))
      GROUP BY co.record_id
    ) sub
    WHERE co.record_id = sub.record_id
    `,
    [recordId]
  )
}
/**
 * @param numeroBio
 * @return {Promise<DBOperatorRecord[]>}
 */
async function findRecords (numeroBio) {
  const { rows } = await pool.query(
    /* sql */`
        SELECT
        ${recordFields},
        jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(cp.geometry)::jsonb,
              'properties',json_build_object(
                'conversion_niveau',cp.conversion_niveau,
                'attente_pac',cp.attente_pac,
                'numero_ilot',cp.numero_ilot_pac
              )
            )
          ) FILTER (WHERE cp.id IS NOT NULL), '[]'::jsonb)
        ) AS geojson,
        COUNT(cp.id) AS parcelles,
        SUM(ST_Area(to_legal_projection(cp.geometry))) AS surface
      FROM cartobio_operators
      LEFT JOIN public.cartobio_parcelles cp
        ON cartobio_operators.record_id = cp.record_id
      WHERE numerobio = $1
        AND cartobio_operators.deleted_at IS NULL
        AND cp.deleted_at IS NULL
      GROUP BY ${recordFields}
      ORDER BY COALESCE(certification_date_debut, audit_date, created_at) DESC, COALESCE(audit_date,created_at) DESC;
    `,
    [numeroBio]
  )

  return rows
}

async function findRecord (recordId) {
  const result = await pool.query(/* sql */`SELECT ${recordFields} FROM cartobio_operators WHERE record_id = $1 LIMIT 1`, [recordId])
  return result.rows[0] ?? null
}


/**
 * @param {DBOperatorRecord=} record
 * @return {Promise<DBOperatorRecordWithParcelles>}
 */
async function findRecordParcelles (record, userId = null) {
  if (record && !record.parcelles) {
    const { rows } = await pool.query(
      /* sql */`
        WITH derniers_parcellaires AS (
    SELECT cp.record_id, cp.id, cp.geometry, c.audit_date, c.numerobio, c.annee_reference_controle
    FROM cartobio_parcelles cp
    JOIN cartobio_operators c ON cp.record_id = c.record_id
    WHERE cp.record_id = $1
),
historique_cultures AS (
    SELECT
        dp.id AS parcelle_id,
        r.cultures,
        r.conversion_niveau,
        co.annee_reference_controle,
        co.audit_date,
        ST_Area(ST_Intersection(dp.geometry, r.geometry)) / ST_Area(dp.geometry) AS intersection_ratio,
        ST_Equals(dp.geometry, r.geometry) AS geometrie_identique,
        ST_Contains(r.geometry, dp.geometry) AS r_inclut_dp,
        ST_Contains(dp.geometry, r.geometry) AS dp_inclut_r
    FROM cartobio_parcelles r
    JOIN derniers_parcellaires dp ON ST_Intersects(dp.geometry, r.geometry)
    JOIN cartobio_operators co ON r.record_id = co.record_id
    WHERE co.certification_state = 'CERTIFIED'
    AND ST_Isvalid(r.geometry) AND ST_Isvalid(dp.geometry)
    AND co.annee_reference_controle <= dp.annee_reference_controle
    AND (co.audit_date < dp.audit_date OR dp.audit_date IS NULL)
    AND co.numerobio = dp.numerobio
    AND co.annee_reference_controle >= EXTRACT(YEAR FROM CURRENT_DATE) - 3
    AND r.deleted_at IS NULL
    AND co.deleted_at IS NULL
)
SELECT
    cp.*,
    ST_AsGeoJSON(cp.geometry)::json AS geometry,

    pc.id IS NOT NULL AS controlee,
    (
        jsonb_build_array(
            jsonb_build_object(
                'cultures', cp.cultures,
                'conversion_niveau', cp.conversion_niveau,
                'annee_controle', co.annee_reference_controle
            )
        )
        ||
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'cultures', hc.cultures,
                        'conversion_niveau', hc.conversion_niveau,
                        'annee_controle', hc.annee_reference_controle
                    )
                    ORDER BY hc.annee_reference_controle DESC, hc.audit_date DESC
                )
                from historique_cultures hc
                where hc.parcelle_id = cp.id
                  and hc.intersection_ratio >= 0.95
            ),
            '[]'::jsonb
        )
    ) as historique_cultures
FROM cartobio_parcelles cp
LEFT JOIN parcelles_controlees pc ON pc.record_id = $1 AND cp.id = pc.id AND pc.user_id = $2
join cartobio_operators co on co.record_id = cp.record_id
WHERE cp.record_id = $1
  AND cp.deleted_at IS NULL
ORDER BY cp.created ASC;
`,
      [record.record_id, userId]
    )

    return { ...record, parcelles: rows }
  }

  return { ...record, parcelles: record?.parcelles ?? [] }
}
async function fixGeometry (geometry) {
  const result = await pool.query(
    `
    WITH input AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
    ),
    validated AS (
      SELECT
        geom AS original,
        CASE
          WHEN ST_IsValid(geom) THEN geom
          ELSE ST_MakeValid(geom, 'method=structure')
        END AS valid
      FROM input
    ),
    largest AS (
      SELECT
        original,
        valid,
        CASE
          WHEN ST_GeometryType(valid) = 'ST_MultiPolygon' THEN (
            SELECT ST_GeometryN(valid, i)
            FROM generate_series(1, ST_NumGeometries(valid)) AS i
            ORDER BY ST_Area(ST_GeometryN(valid, i), true) DESC
            LIMIT 1
          )
          ELSE valid
        END AS fixed
      FROM validated
    )
    SELECT
      ST_IsValid(original)                                                        AS already_valid,
      ST_GeometryType(fixed) IN ('ST_Polygon', 'ST_MultiPolygon')                AS is_polygon,
      ABS(ST_Area(original, true) - ST_Area(fixed, true)) / 10000                AS diff_ha,
      ABS(
        (ST_Area(original, true) - ST_Area(fixed, true))
        / NULLIF(ST_Area(original, true) / 100, 0)
      )                                                                           AS diff_pct,
      ST_AsGeoJSON(fixed)::json                                                   AS geometry
    FROM largest
  `,
    [JSON.stringify(geometry)]
  )

  const row = result.rows[0]

  if (row.already_valid) {
    return { statut: 'ACCEPTE' }
  }

  if (!row.is_polygon) {
    return { statut: 'UNCORRECTABLE' }
  }

  if (row.diff_ha >= 1 || row.diff_pct >= 1) {
    return { statut: 'ACCEPTENONCORRIGE' }
  }

  return { statut: 'CORRIGE', geometry: row.geometry }
}

async function isEtranger (geometry) {
  const result = await pool.query(
    `
    SELECT NOT EXISTS(
      SELECT fid FROM territoires
      WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), geom)
    ) AS etranger
  `,
    [JSON.stringify(geometry)]
  )
  return result.rows[0].etranger
}
async function communeExists (geometry, code) {
  const result = await pool.query(
    `
    SELECT EXISTS(
      SELECT 1
      FROM communes
      WHERE code = $1
      AND active = true
      AND (
        ST_Within(geometry, ST_SetSRID(ST_GeomFromGeoJSON($2),4326))
        OR ST_Intersects(geometry, ST_SetSRID(ST_GeomFromGeoJSON($2),4326))
      )
    ) AS exists
    `,
    [code, JSON.stringify(geometry)]
  )
  return result.rows[0].exists
}

async function findCommune (geometry, code = null) {
  if (code) {
    const prefilter = await pool.query(
      `SELECT code, geometry
       FROM communes
       WHERE code = $1
         AND active = true
         AND ST_Within(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), geometry)`,
      [code, JSON.stringify(geometry)]
    )

    if (prefilter.rows.length > 0) return prefilter.rows[0].code
  }

  const result = await pool.query(
    `SELECT code, geometry
     FROM communes
     WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), geometry)
      AND active = true
     LIMIT 1`,
    [JSON.stringify(geometry)]
  )

  if (result.rows.length > 0) return result.rows[0].code

  const nearest = await pool.query(
    `SELECT code, geometry
     FROM communes
     WHERE active = true
     ORDER BY ST_Distance(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), geometry)
     LIMIT 1`,
    [JSON.stringify(geometry)]
  )

  return nearest.rows[0].code ?? null
}


module.exports = {
  createOrUpdateOperatorRecord,
  findRecords,
  findRecord,
  findRecordParcelles,
}
