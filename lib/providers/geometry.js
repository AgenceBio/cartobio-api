const pool = require('../db.js')

/**
 * Vérifie et corrige la géométrie entrée si besoin lors d'une création de parcelle
 * @param {string} inputGeomGeoJSON - Géométrie GeoJSON (Feature)
 * @param {string} recordId
 */
async function verifyGeometry (inputGeomGeoJSON, recordId, id = '') {
  /** L'area n'est pas a 0 a cause des imprécision du front, et des segments frontières */
  const query = `
    WITH input AS (
      SELECT ST_GeomFromGeoJSON($1) AS geometry
    )
    SELECT
      p.id,
      ST_Area(ST_Intersection(i.geometry, p.geometry)),
      CASE
        WHEN ST_Contains(i.geometry, p.geometry) OR ST_Within(i.geometry, p.geometry) THEN 'inclusion'
        WHEN ST_Intersects(i.geometry, p.geometry) AND ST_Area(ST_Intersection(i.geometry, p.geometry)) > 0.000000000001 THEN 'overlap'
        ELSE 'ok'
      END AS status
    FROM cartobio_parcelles p, input i
    WHERE p.record_id = $2
    AND p.id != $3
    AND p.deleted_at IS NULL
  `

  const res = await pool.query(query, [
    JSON.stringify(inputGeomGeoJSON),
    recordId,
    id
  ])

  if (res.rows.filter((e) => e.status === 'inclusion').length > 0) {
    return { valid: false }
  }

  const overlaps = res.rows.filter((e) => e.status === 'overlap')

  if (overlaps.length === 0) {
    return { valid: true }
  }

  const correctionQuery = `
    WITH input AS (
      SELECT ST_GeomFromGeoJSON($1) AS geometry
    )
    SELECT
      p.id,
      ST_AsGeoJSON(ST_Difference(i.geometry, p.geometry))::json AS new_minus_intersection,
      ST_AsGeoJSON(ST_Difference(p.geometry, i.geometry))::json AS existing_minus_intersection,
      ST_AsGeoJSON(ST_Intersection(p.geometry, i.geometry))::json AS intersection
    FROM cartobio_parcelles p, input i
      WHERE p.record_id = $2
      AND p.id = ANY($3)
  `

  const correctionRes = await pool.query(correctionQuery, [
    JSON.stringify(inputGeomGeoJSON),
    recordId,
    overlaps.map((p) => p.id)
  ])

  return {
    valid: false,
    corrections: correctionRes.rows
  }
}

/**
 * Vérifie et corrige la géométrie entrée si besoin lors d'une création de parcelle
 * @param {number[]} extent - Extent du rpg dans la tuile cliquée
 */
async function getRpg (extent, surface, codeCulture) {
  const { rows } = await pool.query(
    `
    SELECT rpg_bio.fid, ST_AsGeoJSON(ST_SetSRID(rpg_bio.geom, 3857))::json as geom
    FROM rpg_bio
    WHERE ST_Intersects(ST_MakeEnvelope($1, $2, $3, $4, 3857), ST_SetSRID(rpg_bio.geom, 3857))
    AND surf_adm = $5
    AND code_cultu = $6
    ORDER BY ST_Area(ST_Intersection(ST_MakeEnvelope($1, $2, $3, $4, 3857), ST_SetSRID(rpg_bio.geom, 3857))) DESC
    LIMIT 1
    `,
    [
      extent[0],
      extent[1],
      extent[2],
      extent[3],
      surface,
      codeCulture
    ]
  )

  if (rows.length === 1) {
    return rows[0]
  }
  return null
}

/**
 * Vérifie que deux géométries sont de même géométrie spacial
 * @param {{old:string, new:string}} input - tableau de geom
 */
async function getGeometryEquals (input) {
  const { rows } = await pool.query(
    /* sql */
    `
WITH date_comparison AS (
  SELECT
    r1.record_id as record1_id,
    r2.record_id as record2_id,
    r1.audit_date as audit_date_1,
    r2.audit_date as audit_date_2,
    r1.annee_reference_controle as annee_ref_1,
    r2.annee_reference_controle as annee_ref_2,
    CASE
        WHEN r1.audit_date IS NOT NULL AND r2.audit_date IS NOT NULL THEN
            CASE
                WHEN r1.audit_date < r2.audit_date THEN 'r1_old_r2_new'
                WHEN r1.audit_date > r2.audit_date THEN 'r2_old_r1_new'
                ELSE
                    CASE
                        WHEN r1.created_at < r2.created_at THEN 'r1_old_r2_new'
                        ELSE 'r2_old_r1_new'
                    END
            END
        WHEN r1.audit_date IS NOT NULL AND r2.audit_date IS NULL THEN
            CASE
                WHEN extract(year from r1.audit_date) < COALESCE(r2.annee_reference_controle, 9999) THEN 'r1_old_r2_new'
                WHEN extract(year from r1.audit_date) > COALESCE(r2.annee_reference_controle, 9999) THEN 'r2_old_r1_new'
                ELSE
                    CASE
                        WHEN r1.created_at < r2.created_at THEN 'r1_old_r2_new'
                        ELSE 'r2_old_r1_new'
                    END
            END
        WHEN r1.audit_date IS NULL AND r2.audit_date IS NOT NULL THEN
            CASE
                WHEN COALESCE(r1.annee_reference_controle, 0) < extract(year from r2.audit_date) THEN 'r1_old_r2_new'
                WHEN COALESCE(r1.annee_reference_controle, 0) > extract(year from r2.audit_date) THEN 'r2_old_r1_new'
                ELSE -- années égales
                    CASE
                        WHEN r1.created_at < r2.created_at THEN 'r1_old_r2_new'
                        ELSE 'r2_old_r1_new'
                    END
            END
        ELSE
            CASE
                WHEN COALESCE(r1.annee_reference_controle, 0) < COALESCE(r2.annee_reference_controle, 0) THEN 'r1_old_r2_new'
                WHEN COALESCE(r1.annee_reference_controle, 0) > COALESCE(r2.annee_reference_controle, 0) THEN 'r2_old_r1_new'
                ELSE
                    CASE
                        WHEN r1.created_at < r2.created_at THEN 'r1_old_r2_new'
                        ELSE 'r2_old_r1_new'
                    END
            END
    END as comparison_result
FROM
    (SELECT record_id, audit_date, annee_reference_controle, created_at
     FROM cartobio_operators WHERE record_id = $1) r1
CROSS JOIN
    (SELECT record_id, audit_date, annee_reference_controle, created_at
     FROM cartobio_operators WHERE record_id = $2) r2
),
records_info AS (
  SELECT
    comparison_result,
    CASE WHEN comparison_result = 'r1_old_r2_new' THEN $1 ELSE $2 END as old_record_id,
    CASE WHEN comparison_result = 'r1_old_r2_new' THEN $2 ELSE $1 END as new_record_id
  FROM date_comparison
),
old AS (
  SELECT cp.id, cp.geometry
  FROM cartobio_parcelles cp
  CROSS JOIN records_info ri
  WHERE cp.record_id = ri.old_record_id
    AND cp.geometry IS NOT NULL
),
new AS (
  SELECT cp.id, cp.geometry
  FROM cartobio_parcelles cp
  CROSS JOIN records_info ri
  WHERE cp.record_id = ri.new_record_id
    AND cp.geometry IS NOT NULL
),
deleted AS (
  SELECT
    o.geometry,
    'deleted' AS status,
    o.id as old_id
  FROM old o
  WHERE NOT EXISTS (
    SELECT 1
    FROM new n
    WHERE ST_Intersects(
            ST_MakeValid(n.geometry),
            ST_MakeValid(o.geometry)
          )
      AND ST_Area(ST_Intersection(
            ST_MakeValid(n.geometry),
            ST_MakeValid(o.geometry)
          )) / ST_Area(ST_MakeValid(o.geometry)) > 0.1
  )
),
added AS (
  SELECT
    n.geometry,
    'added' AS status,
    n.id as new_id
  FROM new n
  WHERE NOT EXISTS (
    SELECT 1
    FROM old o
    WHERE ST_Intersects(
            ST_MakeValid(o.geometry),
            ST_MakeValid(n.geometry)
          )
      AND ST_Area(ST_Intersection(
            ST_MakeValid(o.geometry),
            ST_MakeValid(n.geometry)
          )) / ST_Area(ST_MakeValid(n.geometry)) > 0.1
  )
),
modified AS (
  SELECT
    n.geometry,
    'modified' AS status,
    n.id as new_id,
    o.id as old_id
  FROM old o
  JOIN new n ON ST_Intersects(
                  ST_MakeValid(o.geometry),
                  ST_MakeValid(n.geometry)
                )
    AND ST_Area(ST_Intersection(
          ST_MakeValid(o.geometry),
          ST_MakeValid(n.geometry)
        )) > 0.00000001
  WHERE NOT ST_Equals(
    ST_ReducePrecision(ST_MakeValid(n.geometry), 0.0001),
    ST_ReducePrecision(ST_MakeValid(o.geometry), 0.0001)
  )
),
all_changes AS (
  SELECT geometry, status FROM modified
  UNION ALL
  SELECT geometry, status FROM deleted
  UNION ALL
  SELECT geometry, status FROM added
)
SELECT
  ri.comparison_result,
  CASE
    WHEN COUNT(ac.*) = 0 THEN
      jsonb_build_object(
        'type', 'FeatureCollection',
        'features', '[]'::jsonb
      )
    ELSE
      jsonb_build_object(
        'type', 'FeatureCollection',
        'features', jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'properties', jsonb_build_object('status', ac.status),
            'geometry', ST_AsGeoJSON(ac.geometry)::jsonb
          )
        )
      )
  END AS geojson
FROM records_info ri
LEFT JOIN all_changes ac ON TRUE
GROUP BY ri.comparison_result;
    `,
    [input.old, input.new]
  )
  if (rows) {
    return rows
  }
  return null
}
module.exports = {
  getRpg,
  verifyGeometry,
  getGeometryEquals
}
