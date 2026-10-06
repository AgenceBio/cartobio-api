"use strict";

const pool = require("../../../src/database/database.js");
const recordFields =
  "cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite";

async function withTransaction(callback) {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteRecord(recordId) {
  await pool.query(
    "UPDATE cartobio_operators SET deleted_at = now() WHERE record_id = $1",
    [recordId]
  );
}
async function markFeatureControlled(recordId, id, userId) {
  await pool.query(
    "INSERT INTO parcelles_controlees (record_id, id, user_id) VALUES ($1, $2, $3) ON CONFLICT (record_id, id, user_id) DO NOTHING",
    [recordId, id, userId]
  );
}
async function markFeatureUncontrolled(recordId, id, userId) {
  await pool.query(
    "DELETE FROM parcelles_controlees WHERE record_id = $1 AND id = $2 AND user_id = $3",
    [recordId, id, userId]
  );
}
async function findMixite(recordId) {
  const { rows } = await pool.query(
    "SELECT CASE WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'AB') = COUNT(*) THEN 'AB' WHEN COUNT(*) FILTER (WHERE conversion_niveau IN ('C1','C2','C3','AB')) = COUNT(*) THEN 'ABCONV' WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'CONV') > 0 THEN 'MIXTE' END AS mixite FROM cartobio_parcelles WHERE record_id = $1 AND deleted_at IS NULL",
    [recordId]
  );
  return rows[0]?.mixite ?? null;
}
async function updateAuditRecord(recordId, columns, placeholders, values) {
  const { rows } = await pool.query(
    `UPDATE cartobio_operators SET (${columns.join(
      ", "
    )}) = (${placeholders.join(
      ", "
    )}) WHERE record_id = $1 RETURNING ${recordFields}`,
    [recordId, ...values]
  );
  return rows;
}
async function markCertificationNotified(recordId) {
  await pool.query(
    "UPDATE cartobio_operators SET date_derniere_notif = NOW() WHERE record_id = $1",
    [recordId]
  );
}
async function setOperatorUpdatedAt(
  client,
  recordId,
  historyEntry,
  ocId,
  ocLabel
) {
  return client.query(
    `UPDATE cartobio_operators SET updated_at = now(), audit_history = (audit_history || coalesce($2, '[]')::jsonb), oc_id = coalesce(oc_id, $3), oc_label = coalesce(oc_label, $4) WHERE record_id = $1 RETURNING ${recordFields}`,
    [recordId, historyEntry, ocId, ocLabel]
  );
}
async function patchFeature(client, recordId, featureId, feature) {
  return client.query(
    `UPDATE cartobio_parcelles SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes, annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac, reference_cadastre, code_culture_pac, code_precision_pac) = (coalesce($3, geometry), coalesce($4, commune), coalesce($5, cultures), coalesce($6, conversion_niveau), nullif(coalesce($7::text, engagement_date::text), '')::date, coalesce($8, commentaire), coalesce($9, auditeur_notes), coalesce($10, annotations), now(), coalesce($11, name), coalesce($12, numero_pacage), coalesce($13, numero_ilot_pac), coalesce($14, numero_parcelle_pac), coalesce($15, reference_cadastre), coalesce($16, code_culture_pac), coalesce($17, code_precision_pac)) WHERE record_id = $1 AND id = $2 RETURNING record_id, id`,
    [
      recordId,
      featureId,
      feature.geometry,
      feature.properties.COMMUNE,
      feature.properties.cultures
        ? JSON.stringify(feature.properties.cultures)
        : null,
      feature.properties.conversion_niveau,
      feature.properties.engagement_date,
      feature.properties.commentaires,
      feature.properties.auditeur_notes,
      feature.properties.annotations
        ? JSON.stringify(feature.properties.annotations)
        : null,
      feature.properties.NOM,
      feature.properties.PACAGE,
      feature.properties.NUMERO_I,
      feature.properties.NUMERO_P,
      feature.properties.cadastre,
      feature.properties.TYPE,
      feature.properties.CODE_VAR,
    ]
  );
}
async function updateFeature(
  client,
  recordId,
  featureId,
  properties,
  geometry
) {
  return client.query(
    `UPDATE cartobio_parcelles SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes, annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac, reference_cadastre, code_culture_pac, code_precision_pac, attente_pac) = (coalesce($3, geometry), coalesce($4, commune), coalesce($5, cultures), coalesce($6, conversion_niveau), nullif(coalesce($7::text, engagement_date::text), '')::date, coalesce($8, commentaire), coalesce($9, auditeur_notes), coalesce($10, annotations), now(), coalesce($11, name), coalesce($12, numero_pacage), coalesce($13, numero_ilot_pac), coalesce($14, numero_parcelle_pac), coalesce($15, reference_cadastre), coalesce($16, code_culture_pac), coalesce($17, code_precision_pac), coalesce($18, attente_pac)) WHERE record_id = $1 AND id = $2`,
    [
      recordId,
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
      properties.CODE_VAR,
      properties.attente_pac,
    ]
  );
}
async function deleteFeature(client, recordId, featureId) {
  await client.query(
    "DELETE FROM cartobio_parcelles WHERE record_id = $1 AND id = $2",
    [recordId, featureId]
  );
}
async function addFeature(client, recordId, id, feature) {
  await client.query(
    `INSERT INTO cartobio_parcelles (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes, annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac, reference_cadastre, code_culture_pac, code_precision_pac) VALUES ($1, $2, $3, $4, coalesce($5, '[]')::jsonb, $6, $7, $8, $9, coalesce($10, '[]')::jsonb, now(), now(), $11, $12, $13, $14, $15, $16, $17)`,
    [
      recordId,
      id,
      feature.geometry,
      feature.properties.COMMUNE,
      JSON.stringify(feature.properties.cultures ?? []),
      feature.properties.conversion_niveau,
      feature.properties.engagement_date || undefined,
      feature.properties.commentaires,
      feature.properties.auditeur_notes,
      JSON.stringify(feature.properties.annotations ?? []),
      feature.properties.NOM,
      feature.properties.PACAGE,
      feature.properties.NUMERO_I,
      feature.properties.NUMERO_P,
      feature.properties.cadastre,
      feature.properties.TYPE,
      feature.properties.CODE_VAR,
    ]
  );
}
async function softDeleteFeatures(client, recordId, featureIds) {
  await client.query(
    "UPDATE cartobio_parcelles SET deleted_at = now() WHERE record_id = $1 AND id = ANY($2)",
    [recordId, featureIds]
  );
}
async function addFeaturesFromOther(client, recordId, features, from) {
  for (const feature of features) {
    const id = Date.now() + Math.round(Math.random() * 1000);
    await client.query(
      "INSERT INTO cartobio_parcelles (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes, annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac, reference_cadastre, code_culture_pac, code_precision_pac, from_parcelles) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), $11, $12, $13, $14, $15, $16, $17, $18)",
      [
        recordId,
        id,
        feature.geometry,
        feature.properties.COMMUNE,
        JSON.stringify(feature.properties.cultures),
        feature.properties.conversion_niveau,
        feature.properties.engagement_date || undefined,
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
        from,
      ]
    );
  }
}
async function refreshMixite(client, recordId) {
  await client.query(
    `UPDATE cartobio_operators SET mixite = mixite_data.mixite FROM (SELECT CASE WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'AB') = COUNT(*) THEN 'AB' WHEN COUNT(*) FILTER (WHERE conversion_niveau IN ('C1', 'C2', 'C3', 'AB')) = COUNT(*) THEN 'ABCONV' WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'CONV') > 0 THEN 'MIXTE' END AS mixite FROM cartobio_parcelles WHERE record_id = $1 AND deleted_at IS NULL) AS mixite_data WHERE record_id = $1`,
    [recordId]
  );
}

module.exports = {
  withTransaction,
  deleteRecord,
  markFeatureControlled,
  markFeatureUncontrolled,
  findMixite,
  updateAuditRecord,
  markCertificationNotified,
  setOperatorUpdatedAt,
  patchFeature,
  updateFeature,
  deleteFeature,
  addFeature,
  softDeleteFeatures,
  addFeaturesFromOther,
  refreshMixite,
};
