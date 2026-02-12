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
    [extent[0], extent[1], extent[2], extent[3], surface, codeCulture]
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
    AND cp.deleted_at IS NULL

),
new AS (
  SELECT cp.id, cp.geometry
  FROM cartobio_parcelles cp
  CROSS JOIN records_info ri
  WHERE cp.record_id = ri.new_record_id
    AND cp.geometry IS NOT NULL
    AND cp.deleted_at IS NULL

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
    WHERE
    ST_Intersects(
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
    WHERE
 ST_Intersects(
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
  WHERE
  NOT ST_Equals(
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

/**
 * Couper la bordure d'une parcelle avec PostGIS
 * @param {Object} geometry - Géométrie GeoJSON de la parcelle en EPSG:4326
 * @param {number} distance - Distance de la bordure en mètres
 * @param {boolean} allBorder - Si true, retourne toute la bordure, sinon bordure entre 2 points
 * @param {boolean} isInverted - Si true, inverse le côté de la bordure
 * @param {number[]} [startBorderPoint] - Point de début [lng, lat]
 * @param {number[]} [endBorderPoint] - Point de fin [lng, lat]
 */
async function calculateParcelBorder (
  geometry,
  distance,
  allBorder,
  isInverted,
  startBorderPoint,
  endBorderPoint
) {
  let query

  if (allBorder) {
    query = `
        WITH parcelle AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
        ),
        parcelle_3857 AS (
          SELECT ST_Transform(geom, 3857) AS geom FROM parcelle
        ),
        parcelle_agrandie AS (
          SELECT ST_Buffer(geom, 0.01) AS geom FROM parcelle_3857
        ),
        parcelle_sans_bordure AS (
          SELECT ST_Buffer(geom, -($2 + 0.01)) AS geom FROM parcelle_agrandie
        ),
        bordure_3857 AS (
          SELECT ST_Difference(pa.geom, psb.geom) AS geom
          FROM parcelle_agrandie pa, parcelle_sans_bordure psb
        ),
        bordure AS (
          SELECT ST_Transform(geom, 4326) AS geom FROM bordure_3857
        ),
        sans_bordure_3857 AS (
          SELECT ST_Difference(p.geom, b.geom) AS geom
          FROM parcelle_3857 p, bordure_3857 b
        ),
        sans_bordure AS (
          SELECT ST_Transform(geom, 4326) AS geom FROM sans_bordure_3857
        )
        SELECT
          ST_AsGeoJSON(sb.geom)::json AS parcelle_sans_bordure,
          ST_AsGeoJSON(b.geom)::json AS bordure
        FROM sans_bordure sb, bordure b
      `

    const result = await pool.query(query, [geometry, distance])

    if (!result.rows[0]) {
      throw new Error('Aucun résultat retourné par la requête')
    }

    return {
      parcelleSansBordure: result.rows[0].parcelle_sans_bordure,
      bordure: result.rows[0].bordure
    }
  } else {
    if (!startBorderPoint || !endBorderPoint) {
      throw new Error('Les deux points sont requis')
    }

    query = `
    WITH parcelle AS (
      SELECT ST_Transform(
        ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
        3857
      ) AS geom
    ),
    contour AS (
      SELECT ST_ExteriorRing(geom) AS geom FROM parcelle
    ),
    points AS (
      SELECT
        ST_Transform(ST_SetSRID(ST_MakePoint($3, $4), 4326), 3857) AS s,
        ST_Transform(ST_SetSRID(ST_MakePoint($5, $6), 4326), 3857) AS e
    ),
    pos AS (
      SELECT
        ST_LineLocatePoint(c.geom, p.s) AS sp,
        ST_LineLocatePoint(c.geom, p.e) AS ep,
        c.geom AS contour
      FROM contour c, points p
    ),
    arc_normal AS (
      SELECT
        ST_LineSubstring(
          contour,
          LEAST(sp, ep),
          GREATEST(sp, ep)
        ) AS geom
      FROM pos
    ),
    arc_inverse AS (
      SELECT
        ST_LineMerge(
          ST_Collect(
            ST_LineSubstring(contour, GREATEST(sp, ep), 1),
            ST_LineSubstring(contour, 0, LEAST(sp, ep))
          )
        ) AS geom
      FROM pos
    ),
    arc AS (
      SELECT geom FROM arc_normal WHERE $7 = 0
      UNION ALL
      SELECT geom FROM arc_inverse WHERE $7 = 1
    ),
    arc_offset_negatif AS (
      SELECT
        ST_OffsetCurve(geom, (-1.0 * $2::float), 'quad_segs=8 join=round miter_limit=3') AS geom
      FROM arc
    ),
    arc_offset_positif AS (
      SELECT
        ST_OffsetCurve(geom, ($2::float), 'quad_segs=8 join=round miter_limit=3') AS geom
      FROM arc
    ),
    arc_interieur AS (
      SELECT
        CASE
          WHEN ST_Within(ST_Centroid(aon.geom), p.geom) THEN aon.geom
          ELSE aop.geom
        END AS geom
      FROM arc_offset_negatif aon, arc_offset_positif aop, parcelle p
    ),
    bordure_avec_fermeture AS (
      SELECT
        ST_MakeLine(ARRAY[
          ST_StartPoint(a.geom),
          ST_StartPoint(ai.geom)
        ]) AS ligne_debut,
        ST_MakeLine(ARRAY[
          ST_EndPoint(a.geom),
          ST_EndPoint(ai.geom)
        ]) AS ligne_fin,
        a.geom AS arc_ext,
        ST_Reverse(ai.geom) AS arc_int
      FROM arc a, arc_interieur ai
    ),
    bordure_3857 AS (
      SELECT
        ST_MakePolygon(
          ST_LineMerge(
            ST_Collect(ARRAY[arc_ext, ligne_fin, arc_int, ligne_debut])
          )
        ) AS geom
      FROM bordure_avec_fermeture
    ),
    sans_bordure AS (
      SELECT ST_Difference(p.geom, b.geom) AS geom
      FROM parcelle p, bordure_3857 b
    )
    SELECT
      ST_AsGeoJSON(ST_Transform(sb.geom, 4326))::json AS parcelle_sans_bordure,
      ST_AsGeoJSON(ST_Transform(b.geom, 4326))::json  AS bordure
    FROM sans_bordure sb, bordure_3857 b`

    const result = await pool.query(query, [
      geometry,
      distance,
      startBorderPoint[0],
      startBorderPoint[1],
      endBorderPoint[0],
      endBorderPoint[1],
      isInverted ? 1 : 0
    ])

    if (!result.rows[0]) {
      throw new Error('Aucun résultat retourné')
    }
    console.log(result.rows[0])
    return {
      parcelleSansBordure: result.rows[0].parcelle_sans_bordure,
      bordure: result.rows[0].bordure
    }
  }
}

module.exports = {
  getRpg,
  verifyGeometry,
  getGeometryEquals,
  calculateParcelBorder
}
