import type { PoolClient } from 'pg'
import type { Polygon } from 'geojson'

import pool from '../../database/database.js'
import type { CertificationState } from '@agencebio/cartobio-types'
import type { DBOperatorRecord, DBOperatorRecordWithParcelles, DBParcelle, NormalizedRecord, HistoryEntry, CartoBioFeatureInput } from '@agencebio/cartobio-types'
import { MissingGeometryApiError } from '../errors.js'
import { getRandomFeatureId } from '../outputs/features.js'

const recordFields = /* sqlFragment */`cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite`

async function findCertificationStateAtAuditDate (client: PoolClient, numerobio: string | undefined, auditDate: string | null | undefined): Promise<string | null> {
  if (!auditDate) return null

  const { rows } = await client.query<{ certification_state: string }>(`
    SELECT certification_state
    FROM cartobio_operators
    WHERE numerobio = $1
      AND audit_date = $2
      AND deleted_at IS NULL
  `, [numerobio, auditDate])

  return rows[0]?.certification_state ?? null
}

async function findMatchingPreviousParcelle (client: PoolClient, numerobio: string, previousRecordId: string, geometry: CartoBioFeatureInput['geometry']): Promise<DBParcelle | null> {
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
    [numerobio, previousRecordId, geometry]
  )

  return rows[0] ?? null
}

async function copyParcellesFromPreviousRecord (client: PoolClient, recordId: string, numerobio: string, previousRecordId: string): Promise<Array<DBParcelle>> {
  const { rows } = await client.query(
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
    [recordId, numerobio, previousRecordId]
  )

  return rows
}

async function markCertificationNotified (client: Pick<PoolClient, 'query'>, recordId: string): Promise<void> {
  await client.query(
    /* sql */`
      UPDATE cartobio_operators
      SET date_derniere_notif = NOW()
      WHERE record_id = $1
    `,
    [recordId])
}

/**
 * Insert or update a cartobio_operators row
 */
async function upsertOperator (client: PoolClient, record: Omit<Partial<NormalizedRecord>, 'parcelles'>, certificationState: CertificationState, historyEntry: HistoryEntry): Promise<import('pg').QueryResult<DBOperatorRecord>> {
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
 */
async function upsertParcelles (client: PoolClient, recordId: string, features: Array<CartoBioFeatureInput>): Promise<Array<DBParcelle>> {
  const parcelles: DBParcelle[] = []
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
          /* $19 */ feature.properties.attente_pac ?? null
        ]
      )

      if (!partialUpdateRows.length) {
        throw new MissingGeometryApiError('Impossible de créer une parcelle sans donnée géographique.')
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
          COALESCE($20::boolean, false)
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
        /* $20 */ feature.properties.attente_pac ?? null

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
 */
async function deleteMissingParcelles (client: PoolClient, recordId: string, parcelles: Array<DBParcelle>): Promise<void> {
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
 */
async function updateMixite (client: PoolClient, recordId: string): Promise<void> {
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
async function findRecords (numeroBio: string | number): Promise<Array<Omit<DBOperatorRecord, 'parcelles'> & { surface: number; parcelles: number }>> {
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

async function findRecord (recordId: string): Promise<DBOperatorRecord | null> {
  const result = await pool.query<DBOperatorRecord>(/* sql */`SELECT ${recordFields} FROM cartobio_operators WHERE record_id = $1 LIMIT 1`, [recordId])
  return result.rows[0] ?? null
}


async function findRecordParcelles (record: DBOperatorRecord, userId: number | null = null): Promise<DBOperatorRecordWithParcelles> {
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
type GeometryFixAnalysis = {
  already_valid: boolean
  is_polygon: boolean
  diff_ha: number
  diff_pct: number
  geometry: Polygon
}

async function analyzeGeometryFix (geometry: Polygon): Promise<GeometryFixAnalysis> {
  const result = await pool.query<GeometryFixAnalysis>(
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

  return result.rows[0]
}

async function isEtranger (geometry: Polygon): Promise<boolean> {
  const result = await pool.query<{ etranger: boolean }>(
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
async function communeExists (geometry: Polygon, code: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
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

async function findCommune (geometry: Polygon, code: string | null = null): Promise<string | null> {
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


export {
  findCertificationStateAtAuditDate,
  findMatchingPreviousParcelle,
  copyParcellesFromPreviousRecord,
  markCertificationNotified,
  upsertOperator,
  upsertParcelles,
  deleteMissingParcelles,
  updateMixite,
  findRecords,
  findRecord,
  findRecordParcelles,
  analyzeGeometryFix,
  isEtranger,
  communeExists,
  findCommune
}
