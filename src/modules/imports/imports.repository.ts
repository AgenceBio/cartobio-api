import pool from '../../database/database.js'
import type { DBOperatorRecord } from '@agencebio/cartobio-types'

export type ImportJobStatus = 'CREATE' | 'CREATED' | 'PENDING' | 'DONE' | 'ERROR'

export type ImportJobResult = 'REJECTED' | 'VALID' | 'ERROR'

export interface ImportJobRow {
  status: ImportJobStatus
  numerobio: string | null
  numeroclient: string | null
  audit_date: string | null
  result_job: Record<string, unknown> | null
  ended_at: Date | null
  created_at: Date
}

export interface PacageParcelleRow {
  geometry: import('geojson').Polygon
  NUMERO_I: string
  NUMERO_P: string
  BIO: number
  TYPE: string
  CODE_VAR: string
  fid: number
}

async function completeImportJob ({ result, jobId, statutJob = null }: { result: unknown; jobId: string | number; statutJob?: ImportJobResult | null }): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `UPDATE parcellaire_import SET result_job = $1, status = 'DONE', ended_at = NOW(),
      statut_job = COALESCE($3::result_job_enum, statut_job)
      WHERE id = $2 RETURNING id`,
    [JSON.stringify(result), jobId, statutJob]
  )
  return rows[0].id
}

async function insertImportLog (importId: string | number, { numeroBio, idParcelle = null, nomParcelle = null, type, code, message }: { numeroBio?: string; idParcelle?: string | number | null; nomParcelle?: string | null; type: string; code: string; message: string }): Promise<void> {
  await pool.query(
    `INSERT INTO parcellaire_import_logs (import_id, numero_bio, parcelle_id, parcelle_name, type, code, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [importId, numeroBio, idParcelle, nomParcelle, type, code, message]
  )
}

async function createImportJob (organismeCertificateurId: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO parcellaire_import (status, organisme_certificateur) VALUES ($1, $2) RETURNING id',
    ['CREATED', organismeCertificateurId]
  )
  return rows[0].id
}

async function insertPayload (jobId: string | number, payload: unknown): Promise<void> {
  await pool.query('INSERT INTO parcellaire_import_payload(import_id, payload) VALUES ($1, $2)', [jobId, JSON.stringify(payload)])
}

async function updateImportJobRecordInfos (jobId: string | number, { numeroBio, numeroClient, auditDate }: { numeroBio: string | null; numeroClient: string | null; auditDate: string | null }): Promise<void> {
  await pool.query(
    'UPDATE parcellaire_import SET numerobio=$1, numeroclient=$2, audit_date=$3 WHERE id=$4',
    [numeroBio, numeroClient, auditDate, jobId]
  )
}

/**
 * Renseigne les informations du record et détermine s'il s'agit d'une création
 * ou de la mise à jour d'un parcellaire existant (colonne etat)
 */
async function updateImportJobEtat (jobId: string | number, { numeroBio, numeroClient, auditDate }: { numeroBio: string | null; numeroClient: string | null; auditDate: string | null }): Promise<void> {
  await pool.query(
    `
      UPDATE parcellaire_import AS current_job
      SET
        numerobio = $1::text,
        numeroclient = $2::text,
        audit_date = $3::date,
        etat = CASE
          WHEN $1::text IS NULL
            OR $2::text IS NULL
            OR $3::date IS NULL
            THEN 'UNKNOWN'::etat_enum

          WHEN EXISTS (
            SELECT 1
            FROM cartobio_operators AS operator_record
            WHERE operator_record.numerobio = $1::text
              AND operator_record.audit_date = $3::date
              AND operator_record.deleted_at IS NULL
          )
            THEN 'UPDATED'::etat_enum

          ELSE 'CREATED'::etat_enum
        END
      WHERE current_job.id = $4::integer
    `,
    [numeroBio, numeroClient, auditDate, jobId]
  )
}

async function updateImportJobResult (jobId: string | number, statutJob: ImportJobResult): Promise<void> {
  await pool.query('UPDATE parcellaire_import SET statut_job = $1 WHERE id = $2', [statutJob, jobId])
}

async function failImportJob (jobId: string | number, result: { name: string; message: string }): Promise<void> {
  await pool.query(
    `
      UPDATE parcellaire_import
      SET
        status = 'ERROR',
        statut_job = 'ERROR'::result_job_enum,
        result_job = $1,
        ended_at = NOW()
      WHERE id = $2
    `,
    [JSON.stringify(result), jobId]
  )
}

async function findImportJob (id: string | number, organismeCertificateur: number): Promise<ImportJobRow | null> {
  const { rows } = await pool.query<ImportJobRow>(
    'SELECT status, numerobio, numeroclient, audit_date, result_job, ended_at, created_at FROM parcellaire_import WHERE id = $1 AND organisme_certificateur = $2',
    [id, organismeCertificateur]
  )
  return rows[0] ?? null
}

async function updateImportJobStatus (jobId: string | number, status: ImportJobStatus, result?: Record<string, unknown>): Promise<void> {
  if (status === 'DONE' || status === 'ERROR') {
    await pool.query('UPDATE parcellaire_import SET status = $1, result_job = $2, ended_at = NOW() WHERE id = $3', [status, result ?? '{}', jobId])
    return
  }
  await pool.query('UPDATE parcellaire_import SET status = $1, result_job = $2 WHERE id = $3', [status, result ?? '{}', jobId])
}

async function findImportList ({ status, organismeCertificateur, from, to, payload, withRejected, page, limit }: { status?: string; organismeCertificateur?: number; from?: string; to?: string; payload?: string; withRejected?: string; page: number; limit: number }) {
  const conditions: string[] = []
  const params: unknown[] = []
  let index = 1
  if (status) { conditions.push(`pi.status = ANY($${index}::text[])`); params.push(status.split(',').map(value => value.trim().toUpperCase())); index++ }
  if (from) { conditions.push(`pi.created_at >= $${index}`); params.push(new Date(from)); index++ }
  if (organismeCertificateur) { conditions.push(`pi.organisme_certificateur = $${index}`); params.push(organismeCertificateur); index++ }
  if (to) { const end = new Date(to); end.setHours(23, 59, 59, 999); conditions.push(`pi.created_at <= $${index}`); params.push(end); index++ }
  if (withRejected === 'true') conditions.push('pi.nb_objets_refuses >= 1')
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const includePayload = payload === 'true'
  const selectPayload = includePayload ? ", json_build_object('id', pip.id, 'payload', pip.payload) AS payload" : ', NULL AS payload'
  const joinPayload = includePayload ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id' : ''
  const offset = (page - 1) * limit
  const [data, count] = await Promise.all([
    pool.query(`SELECT pi.id AS jobId, pi.status, pi.created_at, pi.ended_at, pi.numerobio,
      pi.numeroclient, pi.audit_date, pi.result_job ${selectPayload}
      FROM parcellaire_import pi ${joinPayload} ${where} ORDER BY pi.created_at DESC
      LIMIT $${index} OFFSET $${index + 1}`, [...params, limit, offset]),
    pool.query<{ total: string }>(`SELECT COUNT(*) AS total FROM parcellaire_import pi ${where}`, params)
  ])
  return { rows: data.rows, total: parseInt(count.rows[0].total) }
}

async function findImportById (id: string | number, organismeCertificateur: number, payload?: string) {
  const includePayload = payload === 'true'
  const selectPayload = includePayload ? ", json_build_object('id', pip.id, 'payload', pip.payload) AS payload" : ', NULL AS payload'
  const joinPayload = includePayload ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id' : ''
  const { rows } = await pool.query(`SELECT pi.id AS jobId, pi.status, pi.created_at, pi.started_at, pi.ended_at,
    pi.numerobio, pi.numeroclient, pi.audit_date, pi.result_job ${selectPayload}
    FROM parcellaire_import pi ${joinPayload} WHERE pi.id = $1 AND pi.organisme_certificateur = $2`, [id, organismeCertificateur])
  return rows[0] ?? null
}

async function findPacageParcelles (numeroPacage: string): Promise<PacageParcelleRow[]> {
  const { rows } = await pool.query<PacageParcelleRow>(`SELECT DISTINCT ON (pacage, num_ilot, num_parcel)
    ST_AsGeoJSON(geom, 15)::json AS geometry, num_ilot AS "NUMERO_I", num_parcel AS "NUMERO_P",
    bio AS "BIO", code_cultu AS "TYPE", precision AS "CODE_VAR", fid FROM rpg_bio WHERE pacage = $1`, [numeroPacage])
  return rows
}

async function findLastOperatorRecord (numeroBio: string | number, { anneeAudit = null, statut = null }: { anneeAudit?: string | number | null; statut?: string | null } = {}): Promise<DBOperatorRecord | null> {
  const conditions: string[] = []
  const values: Array<string | number> = [numeroBio]
  if (anneeAudit) { conditions.push(`EXTRACT('year' FROM audit_date) = $${values.length + 1}`); values.push(anneeAudit) }
  if (statut) { conditions.push(`certification_state = $${values.length + 1}`); values.push(statut) }
  const { rows } = await pool.query<DBOperatorRecord>(`SELECT cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite FROM cartobio_operators WHERE numerobio = $1 AND deleted_at IS NULL ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 1`, values)
  return rows[0] ?? null
}

export const query = ((...args: unknown[]) => (pool.query as (...a: unknown[]) => unknown)(...args)) as typeof pool.query
export const connect = () => pool.connect()
export {
  completeImportJob,
  insertImportLog,
  createImportJob,
  insertPayload,
  updateImportJobRecordInfos,
  updateImportJobEtat,
  updateImportJobResult,
  failImportJob,
  findImportJob,
  updateImportJobStatus,
  findImportList,
  findImportById,
  findPacageParcelles,
  findLastOperatorRecord
}
