'use strict'

const pool = require('../../../src/database/database.js')

function updateAttestationsProductions (recordId, status, type, path = null) {
  return pool.query(
    `INSERT INTO attestations_productions (record_id, type, status, path)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (record_id, type)
     DO UPDATE SET status = $3, path = $4, updated_at = CURRENT_TIMESTAMP`,
    [recordId, type, status, path]
  )
}

async function findValidAttestationProduction (recordId, type) {
  const { rows } = await pool.query(
    `SELECT path FROM attestations_productions ap
     JOIN cartobio_operators co ON co.record_id = ap.record_id
     WHERE ap.record_id = $1 AND ap.updated_at > co.updated_at
       AND ap.status = 'generated' AND ap.type = $2`,
    [recordId, type]
  )
  return rows[0] ?? null
}

async function findPdfRecord (recordId) {
  const { rows } = await pool.query(
    `SELECT co.version_name, co.audit_date, co.annee_reference_controle, co.mixite,
       co.oc_label, co.certification_date_debut, co.certification_date_fin, co.metadata,
       (SELECT STRING_AGG(t.numero_pacage::text, ', ' ORDER BY t.numero_pacage)
        FROM (SELECT DISTINCT NULLIF(TRIM(cp.numero_pacage::text), '') AS numero_pacage
              FROM cartobio_parcelles cp WHERE cp.record_id = co.record_id) t) AS numeros_pacage
     FROM cartobio_operators co WHERE co.record_id = $1`,
    [recordId]
  )
  return rows[0] ?? null
}

async function findExportRows (ocId, numeroBios) {
  const { rows } = await pool.query(
    `SELECT co.record_id, co.numerobio, co.version_name, co.metadata->>'source' AS source,
       co.metadata->>'provenance' AS provenance, co.metadata->>'campagne' AS campagne,
       co.created_at, co.updated_at, co.mixite, co.annee_reference_controle AS anneereference,
       co.certification_state, COALESCE(NULLIF(co.audit_date, '1970-01-01'), NULL) AS audit_date,
       co.audit_notes, COALESCE(NULLIF(co.certification_date_debut, '1970-01-01'), NULL) AS certification_date_debut,
       COALESCE(NULLIF(co.certification_date_fin, '1970-01-01'), NULL) AS certification_date_fin,
       COUNT(cp.record_id) AS nombre_parcelles,
       COALESCE(ROUND(SUM(ST_Area(ST_Transform(cp.geometry, 2154)) / 10000)::numeric, 2), 0) AS superficie_totale_ha,
       COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'CONV' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric, 2), 0) AS surface_conventionnel_ha,
       COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'C1' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric, 2), 0) AS surface_c1_ha,
       COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'C2' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric, 2), 0) AS surface_c2_ha,
       COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'C3' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric, 2), 0) AS surface_c3_ha,
       COALESCE(ROUND(SUM(CASE WHEN cp.conversion_niveau = 'AB' THEN ST_Area(ST_Transform(cp.geometry, 2154)) / 10000 ELSE 0 END)::numeric, 2), 0) AS surface_ab_ha
     FROM cartobio_operators co LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
     WHERE co.oc_id = $1 AND numerobio = ANY($2) AND co.deleted_at IS NULL AND cp.deleted_at IS NULL
     GROUP BY co.record_id ORDER BY co.numerobio::bigint ASC`,
    [ocId, numeroBios]
  )
  return rows
}

async function findPdfParcelles (recordId, pac) {
  const { rows } = await pool.query(
    `SELECT cp.id, cp.name, cp.cultures, cp.conversion_niveau, cp.commune,
       COALESCE(c.nom, 'inconnu') AS communename, cp.created, cp.engagement_date,
       cp.numero_ilot_pac AS nbilot, cp.numero_parcelle_pac AS nbp,
       cp.reference_cadastre AS refcad, ST_AsGeoJSON(cp.geometry) AS geojson,
       ST_XMin(cp.geometry) AS minx, ST_YMin(cp.geometry) AS miny,
       ST_XMax(cp.geometry) AS maxx, ST_YMax(cp.geometry) AS maxy,
       ST_X(ST_Centroid(cp.geometry)) AS centerx, ST_Y(ST_Centroid(cp.geometry)) AS centery,
       COALESCE(SUM(ST_Area(to_legal_projection(cp.geometry)) / 10000), 0) AS superficie_totale_ha
     FROM cartobio_parcelles cp LEFT JOIN communes c ON c.code = commune
     WHERE record_id = $1 AND cp.deleted_at IS NULL
       ${pac ? "AND ((cp.numero_ilot_pac IS NOT NULL AND cp.numero_parcelle_pac IS NOT NULL AND cp.numero_parcelle_pac <> '0' AND cp.numero_parcelle_pac <> '' AND cp.numero_ilot_pac <> '0' AND cp.numero_ilot_pac <> '') OR cp.attente_pac = TRUE)" : ''}
     GROUP BY cp.id, cp.name, cp.cultures, cp.conversion_niveau, cp.created, cp.numero_ilot_pac,
       cp.numero_parcelle_pac, cp.geometry, cp.engagement_date, cp.commune, cp.reference_cadastre, c.nom`,
    [recordId]
  )
  return rows
}

module.exports = {
  updateAttestationsProductions,
  findValidAttestationProduction,
  findPdfRecord,
  findExportRows,
  findPdfParcelles
}
