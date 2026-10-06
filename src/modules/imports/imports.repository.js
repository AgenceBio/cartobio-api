'use strict'

const pool = require('../../../src/database/database.js')

async function withTransaction (callback) {
  const client = await pool.connect()
  await client.query('BEGIN;')
  try {
    const result = await callback(client)
    await client.query('COMMIT;')
    return result
  } catch (error) {
    await client.query('ROLLBACK;')
    throw error
  } finally {
    client.release()
  }
}

async function completeImportJob ({ accepted, rejected, total, result, jobId }) {
  const { rows } = await pool.query(
    `UPDATE parcellaire_import SET nb_objets_acceptes = $1, nb_objets_refuses = $2,
      nb_objets_recu = $3, result_job = $4, status = 'DONE', ended_at = NOW()
      WHERE id = $5 RETURNING id`,
    [accepted, rejected, total, JSON.stringify(result), jobId]
  )
  return rows[0].id
}

async function insertImportLog (importId, { numeroBio, type, code, message }) {
  await pool.query(
    `INSERT INTO parcellaire_import_logs (import_id, numero_bio, type, code, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [importId, numeroBio, type, code, message]
  )
}

async function createImportJob (organismeCertificateurId) {
  const { rows } = await pool.query(
    'INSERT INTO parcellaire_import (status, organisme_certificateur) VALUES ($1, $2) RETURNING id',
    ['CREATED', organismeCertificateurId]
  )
  return rows[0].id
}

async function insertPayload (jobId, payload) {
  await pool.query('INSERT INTO parcellaire_import_payload(import_id, payload) VALUES ($1, $2)', [jobId, JSON.stringify(payload)])
}

async function findImportJob (id) {
  const { rows } = await pool.query(
    'SELECT status, nb_objets_recu, nb_objets_acceptes, nb_objets_refuses, result_job, ended_at, created_at FROM parcellaire_import WHERE id = $1',
    [id]
  )
  return rows[0] ?? null
}

async function updateImportJobStatus (jobId, status, result) {
  if (status === 'DONE' || status === 'ERROR') {
    await pool.query('UPDATE parcellaire_import SET status = $1, result_job = $2, ended_at = NOW() WHERE id = $3', [status, result ?? '{}', jobId])
    return
  }
  await pool.query('UPDATE parcellaire_import SET status = $1, result_job = $2 WHERE id = $3', [status, result ?? '{}', jobId])
}

async function findImportList ({ status, organismeCertificateur, from, to, payload, withRejected, page, limit }) {
  const conditions = []
  const params = []
  let index = 1
  if (status) { conditions.push(`pi.status = ANY($${index}::text[])`); params.push(status.split(',').map(value => value.trim().toUpperCase())); index++ }
  if (from) { conditions.push(`pi.created_at >= $${index}`); params.push(new Date(from)); index++ }
  if (organismeCertificateur) { conditions.push(`pi.organisme_certificateur = $${index}`); params.push(parseInt(organismeCertificateur)); index++ }
  if (to) { const end = new Date(to); end.setHours(23, 59, 59, 999); conditions.push(`pi.created_at <= $${index}`); params.push(end); index++ }
  if (withRejected === 'true') conditions.push('pi.nb_objets_refuses >= 1')
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const includePayload = payload === 'true'
  const selectPayload = includePayload ? ", json_build_object('id', pip.id, 'payload', pip.payload) AS payload" : ', NULL AS payload'
  const joinPayload = includePayload ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id' : ''
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [data, count] = await Promise.all([
    pool.query(`SELECT pi.id AS jobId, pi.status, pi.created_at, pi.ended_at, pi.nb_objets_recu,
      pi.nb_objets_acceptes, pi.nb_objets_refuses, pi.result_job ${selectPayload}
      FROM parcellaire_import pi ${joinPayload} ${where} ORDER BY pi.created_at DESC
      LIMIT $${index} OFFSET $${index + 1}`, [...params, parseInt(limit), offset]),
    pool.query(`SELECT COUNT(*) AS total FROM parcellaire_import pi ${where}`, params)
  ])
  return { rows: data.rows, total: parseInt(count.rows[0].total) }
}

async function findImportById (id, payload) {
  const includePayload = payload === 'true'
  const selectPayload = includePayload ? ", json_build_object('id', pip.id, 'payload', pip.payload) AS payload" : ', NULL AS payload'
  const joinPayload = includePayload ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id' : ''
  const { rows } = await pool.query(`SELECT pi.id, pi.status, pi.created_at, pi.started_at, pi.ended_at,
    pi.nb_objets_recu, pi.nb_objets_acceptes, pi.nb_objets_refuses, pi.result_job ${selectPayload}
    FROM parcellaire_import pi ${joinPayload} WHERE pi.id = $1`, [id])
  return rows[0] ?? null
}

async function findPacageParcelles (numeroPacage) {
  const { rows } = await pool.query(`SELECT DISTINCT ON (pacage, num_ilot, num_parcel)
    ST_AsGeoJSON(geom, 15)::json AS geometry, num_ilot AS "NUMERO_I", num_parcel AS "NUMERO_P",
    bio AS "BIO", code_cultu AS "TYPE", precision AS "CODE_VAR", fid FROM rpg_bio WHERE pacage = $1`, [numeroPacage])
  return rows
}

async function findLastOperatorRecord (numeroBio, { anneeAudit = null, statut = null } = {}) {
  const conditions = []
  const values = [numeroBio]
  if (anneeAudit) { conditions.push(`EXTRACT('year' FROM audit_date) = $${values.length + 1}`); values.push(anneeAudit) }
  if (statut) { conditions.push(`certification_state = $${values.length + 1}`); values.push(statut) }
  const { rows } = await pool.query(`SELECT cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite FROM cartobio_operators WHERE numerobio = $1 AND deleted_at IS NULL ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 1`, values)
  return rows[0] ?? null
}

module.exports = { withTransaction, completeImportJob, insertImportLog, createImportJob, insertPayload, findImportJob, updateImportJobStatus, findImportList, findImportById, findPacageParcelles, findLastOperatorRecord, query: (...args) => pool.query(...args), connect: () => pool.connect() }
