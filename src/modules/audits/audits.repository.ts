import pool from '../../database/database.js'
import type { PoolClient, QueryResult } from 'pg'
import type { DBOperatorRecord, FeatureInput, FeaturePropertiesInput, HistoryEntry } from '@agencebio/cartobio-types'

type FeatureId = string | number
const recordFields =
  'cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite'

async function deleteRecord(recordId: string): Promise<void> {
  await pool.query('UPDATE cartobio_operators SET deleted_at = now() WHERE record_id = $1', [recordId])
}
async function markFeatureControlled(recordId: string, id: FeatureId, userId: number): Promise<void> {
  await pool.query(
    'INSERT INTO parcelles_controlees (record_id, id, user_id) VALUES ($1, $2, $3) ON CONFLICT (record_id, id, user_id) DO NOTHING',
    [recordId, id, userId]
  )
}
async function markFeatureUncontrolled(recordId: string, id: FeatureId, userId: number): Promise<void> {
  await pool.query('DELETE FROM parcelles_controlees WHERE record_id = $1 AND id = $2 AND user_id = $3', [
    recordId,
    id,
    userId
  ])
}
async function findMixite(recordId: string): Promise<string | null> {
  const { rows } = await pool.query(
    "SELECT CASE WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'AB') = COUNT(*) THEN 'AB' WHEN COUNT(*) FILTER (WHERE conversion_niveau IN ('C1','C2','C3','AB')) = COUNT(*) THEN 'ABCONV' WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'CONV') > 0 THEN 'MIXTE' END AS mixite FROM cartobio_parcelles WHERE record_id = $1 AND deleted_at IS NULL",
    [recordId]
  )
  return rows[0]?.mixite ?? null
}
async function updateAuditRecord(
  recordId: string,
  columns: string[],
  placeholders: string[],
  values: unknown[]
): Promise<DBOperatorRecord[]> {
  const { rows } = await pool.query<DBOperatorRecord>(
    `UPDATE cartobio_operators SET (${columns.join(', ')}) = (${placeholders.join(
      ', '
    )}) WHERE record_id = $1 RETURNING ${recordFields}`,
    [recordId, ...values]
  )
  return rows
}
async function setOperatorUpdatedAt(
  client: PoolClient,
  recordId: string,
  historyEntry: HistoryEntry | null,
  ocId: number | null,
  ocLabel: string | null
): Promise<QueryResult<DBOperatorRecord>> {
  return client.query<DBOperatorRecord>(
    `UPDATE cartobio_operators SET updated_at = now(), audit_history = (audit_history || coalesce($2, '[]')::jsonb), oc_id = coalesce(oc_id, $3), oc_label = coalesce(oc_label, $4) WHERE record_id = $1 RETURNING ${recordFields}`,
    [recordId, historyEntry, ocId, ocLabel]
  )
}
async function patchFeature(client: PoolClient, recordId: string, featureId: FeatureId, feature: FeatureInput) {
  const properties = feature.properties ?? {}
  return client.query(
    `UPDATE cartobio_parcelles SET (geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes, annotations, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac, reference_cadastre, code_culture_pac, code_precision_pac) = (coalesce($3, geometry), coalesce($4, commune), coalesce($5, cultures), coalesce($6, conversion_niveau), nullif(coalesce($7::text, engagement_date::text), '')::date, coalesce($8, commentaire), coalesce($9, auditeur_notes), coalesce($10, annotations), now(), coalesce($11, name), coalesce($12, numero_pacage), coalesce($13, numero_ilot_pac), coalesce($14, numero_parcelle_pac), coalesce($15, reference_cadastre), coalesce($16, code_culture_pac), coalesce($17, code_precision_pac)) WHERE record_id = $1 AND id = $2 RETURNING record_id, id`,
    [
      recordId,
      featureId,
      feature.geometry,
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
    ]
  )
}
async function updateFeature(
  client: PoolClient,
  recordId: string,
  featureId: FeatureId,
  properties: FeaturePropertiesInput,
  geometry: FeatureInput['geometry']
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
      properties.attente_pac
    ]
  )
}
async function deleteFeature(client: PoolClient, recordId: string, featureId: FeatureId): Promise<void> {
  await client.query('DELETE FROM cartobio_parcelles WHERE record_id = $1 AND id = $2', [recordId, featureId])
}
async function addFeature(client: PoolClient, recordId: string, id: FeatureId, feature: FeatureInput): Promise<void> {
  const properties = feature.properties ?? {}
  await client.query(
    `INSERT INTO cartobio_parcelles (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes, annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac, reference_cadastre, code_culture_pac, code_precision_pac) VALUES ($1, $2, $3, $4, coalesce($5, '[]')::jsonb, $6, $7, $8, $9, coalesce($10, '[]')::jsonb, now(), now(), $11, $12, $13, $14, $15, $16, $17)`,
    [
      recordId,
      id,
      feature.geometry,
      properties.COMMUNE,
      JSON.stringify(properties.cultures ?? []),
      properties.conversion_niveau,
      properties.engagement_date || undefined,
      properties.commentaires,
      properties.auditeur_notes,
      JSON.stringify(properties.annotations ?? []),
      properties.NOM,
      properties.PACAGE,
      properties.NUMERO_I,
      properties.NUMERO_P,
      properties.cadastre,
      properties.TYPE,
      properties.CODE_VAR
    ]
  )
}
async function softDeleteFeatures(client: PoolClient, recordId: string, featureIds: FeatureId[]): Promise<void> {
  await client.query('UPDATE cartobio_parcelles SET deleted_at = now() WHERE record_id = $1 AND id = ANY($2)', [
    recordId,
    featureIds
  ])
}
async function addFeaturesFromOther(
  client: PoolClient,
  recordId: string,
  features: FeatureInput[],
  from: FeatureId[]
): Promise<void> {
  for (const feature of features) {
    const id = Date.now() + Math.round(Math.random() * 1000)
    const properties = feature.properties ?? {}
    await client.query(
      'INSERT INTO cartobio_parcelles (record_id, id, geometry, commune, cultures, conversion_niveau, engagement_date, commentaire, auditeur_notes, annotations, created, updated, name, numero_pacage, numero_ilot_pac, numero_parcelle_pac, reference_cadastre, code_culture_pac, code_precision_pac, from_parcelles) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), $11, $12, $13, $14, $15, $16, $17, $18)',
      [
        recordId,
        id,
        feature.geometry,
        properties.COMMUNE,
        JSON.stringify(properties.cultures),
        properties.conversion_niveau,
        properties.engagement_date || undefined,
        properties.commentaires,
        properties.auditeur_notes,
        JSON.stringify(properties.annotations),
        properties.NOM,
        properties.PACAGE,
        properties.NUMERO_I,
        properties.NUMERO_P,
        properties.cadastre,
        properties.TYPE,
        properties.CODE_VAR,
        from
      ]
    )
  }
}
async function refreshMixite(client: PoolClient, recordId: string): Promise<void> {
  await client.query(
    `UPDATE cartobio_operators SET mixite = mixite_data.mixite FROM (SELECT CASE WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'AB') = COUNT(*) THEN 'AB' WHEN COUNT(*) FILTER (WHERE conversion_niveau IN ('C1', 'C2', 'C3', 'AB')) = COUNT(*) THEN 'ABCONV' WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'CONV') > 0 THEN 'MIXTE' END AS mixite FROM cartobio_parcelles WHERE record_id = $1 AND deleted_at IS NULL) AS mixite_data WHERE record_id = $1`,
    [recordId]
  )
}

export {
  deleteRecord,
  markFeatureControlled,
  markFeatureUncontrolled,
  findMixite,
  updateAuditRecord,
  setOperatorUpdatedAt,
  patchFeature,
  updateFeature,
  deleteFeature,
  addFeature,
  softDeleteFeatures,
  addFeaturesFromOther,
  refreshMixite
}
