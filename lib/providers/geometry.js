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

  if (res.rows.filter(e => e.status === 'inclusion').length > 0) {
    return { valid: false }
  }

  const overlaps = res.rows.filter(e => e.status === 'overlap')

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
    [
      extent[0],
      extent[1],
      extent[2],
      extent[3]
    ]
  )

  if (rows.length === 1) {
    return rows[0]
  }
  return null
}
module.exports = {
  getRpg,
  verifyGeometry
}
