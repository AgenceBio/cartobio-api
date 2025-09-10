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
      ST_AsGeoJSON(ST_Difference(p.geometry, i.geometry))::json AS existing_minus_intersection
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
async function getRpg (extent) {
  const { rows } = await pool.query(
    `
    SELECT rpg_bio.fid, ST_AsGeoJSON(ST_SetSRID(rpg_bio.geom, 3857))::json as geom
    FROM rpg_bio
    WHERE ST_Intersects(ST_MakeEnvelope($1, $2, $3, $4, 3857), ST_SetSRID(rpg_bio.geom, 3857))
    ORDER BY ST_Area(ST_Intersection(ST_MakeEnvelope($1, $2, $3, $4, 3857), ST_SetSRID(rpg_bio.geom, 3857))) DESC
    LIMIT 1
    `,
    [extent[0], extent[1], extent[2], extent[3]]
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
              ELSE 'r1_old_r2_new'
            END
          WHEN r1.audit_date IS NOT NULL AND r2.audit_date IS NULL THEN
            CASE
              WHEN extract(year from r1.audit_date) <= COALESCE(r2.annee_reference_controle, 9999) THEN 'r1_old_r2_new'
              ELSE 'r2_old_r1_new'
            END
          WHEN r1.audit_date IS NULL AND r2.audit_date IS NOT NULL THEN
            CASE
              WHEN COALESCE(r1.annee_reference_controle, 0) <= extract(year from  r2.audit_date) THEN 'r1_old_r2_new'
              ELSE 'r2_old_r1_new'
            END
          ELSE
            CASE
              WHEN COALESCE(r1.annee_reference_controle, 0) < COALESCE(r2.annee_reference_controle, 0) THEN 'r1_old_r2_new'
              WHEN COALESCE(r1.annee_reference_controle, 0) > COALESCE(r2.annee_reference_controle, 0) THEN 'r2_old_r1_new'
              ELSE 'r1_old_r2_new'
            END
          END as comparison_result
      FROM
        (SELECT record_id, audit_date, annee_reference_controle FROM cartobio_operators WHERE record_id = $1) r1
        CROSS JOIN
        (SELECT record_id, audit_date, annee_reference_controle FROM cartobio_operators WHERE record_id = $2) r2
    ),
    old AS (
      SELECT cp.id, cp.geometry
      FROM cartobio_parcelles cp
      JOIN date_comparison dc ON 1=1
      WHERE cp.record_id = CASE
        WHEN dc.comparison_result = 'r1_old_r2_new' THEN $1
        ELSE $2
      END
    ),
    new AS (
      SELECT cp.id, cp.geometry
      FROM cartobio_parcelles cp
      JOIN date_comparison dc ON 1=1
      WHERE cp.record_id = CASE
        WHEN dc.comparison_result = 'r1_old_r2_new' THEN $2
        ELSE $1
      END
    ),
    deleted AS (
      SELECT o.geometry, 'deleted' AS status
      FROM old o
      WHERE NOT EXISTS (
        SELECT 1 FROM new n
        WHERE ST_Intersects(n.geometry, o.geometry)
      )
    ),
    added AS (
      SELECT n.geometry, 'added' AS status
      FROM new n
      WHERE NOT EXISTS (
        SELECT 1 FROM old o
        WHERE ST_Intersects(o.geometry, n.geometry)
      )
    ),
    modified AS (
      SELECT n.geometry, 'modified' AS status
      FROM new n
      JOIN old o ON ST_Intersects(n.geometry, o.geometry)
      WHERE NOT ST_Equals(st_snaptogrid(n.geometry,0.00001), st_snaptogrid(o.geometry,0.00001))
    ),
    all_changes AS (
      SELECT * FROM modified
      UNION ALL
      SELECT * FROM deleted
      UNION ALL
      SELECT * FROM added
    )
    SELECT dc.comparison_result, jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'properties', jsonb_build_object('status', status),
            'geometry', ST_AsGeoJSON(geometry)::jsonb
          )
        ), '[]'::jsonb
      )
    ) AS geojson
    FROM all_changes
    JOIN date_comparison dc ON 1=1
    GROUP BY dc.comparison_result;

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
