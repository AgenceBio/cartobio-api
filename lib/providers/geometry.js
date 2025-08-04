const pool = require('../db.js')

/**
 * Vérifie et corrige la géométrie entrée si besoin lors d'une création de parcelle
 * @param {string} inputGeomGeoJSON - Géométrie GeoJSON (Feature)
 * @param {string} recordId
 */
async function verifyGeometry (inputGeomGeoJSON, recordId) {
  const query = `
    WITH input AS (
      SELECT ST_GeomFromGeoJSON($1) AS geom
    )
    SELECT
      g.id,
      i.geom,
      ST_AsGeoJSON(g.geometry)::json AS existing_geom,
      CASE
        WHEN ST_Contains(i.geom, g.geometry) OR ST_Within(i.geom, g.geometry) THEN 'inclusion'
        WHEN ST_Intersects(i.geom, g.geometry) THEN 'overlap'
        ELSE 'ok'
      END AS status,
      ST_AsGeoJSON(ST_Difference(i.geom, g.geometry))::json AS input_minus_existing
    FROM cartobio_parcelles g, input i
    WHERE g.record_id = $2
  `

  const res = await pool.query(query, [
    JSON.stringify(inputGeomGeoJSON),
    recordId
  ])

  if (res.rows.filter(e => e.status === 'inclusion').length > 0) {
    return { valid: false }
  }

  const overlaps = res.rows.filter(e => e.status === 'overlap')

  if (overlaps.length === 0) {
    return { valid: true }
  }

  if (overlaps.length === 1) {
    const row = overlaps[0]
    return {
      valid: false,
      correction: {
        input_minus_existing: row.input_minus_existing
      }
    }
  }

  if (overlaps.length > 1) {
    const correctionQuery = `
      WITH input AS (
        SELECT ST_GeomFromGeoJSON($1) AS geom
      ),
      existing_union AS (
        SELECT ST_Union(g.geometry) AS union_geom
        FROM cartobio_parcelles g
        WHERE g.record_id = $2
          AND ST_Intersects(ST_GeomFromGeoJSON($1), g.geometry)
      )
      SELECT
        ST_AsGeoJSON(ST_Difference(i.geom, e.union_geom))::json AS corrected_input
      FROM input i, existing_union e
    `

    const correctionRes = await pool.query(correctionQuery, [
      JSON.stringify(inputGeomGeoJSON),
      recordId
    ])

    return {
      valid: false,
      correction: { corrected_input: correctionRes.rows[0].corrected_input }
    }
  }
}

module.exports = {
  verifyGeometry
}
