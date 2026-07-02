'use strict'

const pool = require('../../db.js')

function toNumber (v) {
  return v !== null ? Number(v) : null
}

async function queryBilanPeriode (organismeCertificateur, from, to) {
  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(nb_objets_recu), 0)     AS "totalRecu",
      COALESCE(SUM(nb_objets_acceptes), 0) AS "totalAcceptes",
      COALESCE(SUM(nb_objets_refuses), 0)  AS "totalRefuses"
    FROM parcellaire_import
    WHERE organisme_certificateur = $1
      AND status = 'DONE'
      AND created_at >= $2
      AND created_at <= $3
    `,
    [organismeCertificateur, from, to]
  )

  const r = rows[0]

  const totalRecu = Number(r.totalRecu)
  const totalRefuses = Number(r.totalRefuses)

  return {
    totalRecu,
    totalAcceptes: Number(r.totalAcceptes),
    totalRefuses,
    tauxRefus: totalRecu > 0 ? Math.round((totalRefuses / totalRecu) * 100) : 0
  }
}

async function getBilanPeriodeRepo (organismeCertificateur, from, to) {
  return queryBilanPeriode(organismeCertificateur, from, to)
}

async function getBilanParGranulariteRepo (organismeCertificateur, from, to, granularity) {
  const { rows } = await pool.query(
    `
    SELECT
      DATE_TRUNC($1, created_at) AS bucket,
      COALESCE(SUM(nb_objets_recu), 0)     AS "totalRecu",
      COALESCE(SUM(nb_objets_acceptes), 0) AS "totalAcceptes",
      COALESCE(SUM(nb_objets_refuses), 0)  AS "totalRefuses"
    FROM parcellaire_import
    WHERE organisme_certificateur = $2
      AND status = 'DONE'
      AND created_at >= $3
      AND created_at <= $4
    GROUP BY bucket
    ORDER BY bucket ASC
    `,
    [granularity, organismeCertificateur, from, to]
  )

  return rows.map(r => {
    const totalRecu = Number(r.totalRecu)
    const totalRefuses = Number(r.totalRefuses)

    return {
      bucket: r.bucket,
      totalRecu,
      totalAcceptes: Number(r.totalAcceptes),
      totalRefuses,
      tauxRefus: totalRecu > 0 ? Math.round((totalRefuses / totalRecu) * 100) : 0
    }
  })
}

async function getResumeSemaineRepo (organismeCertificateur) {
  const [bilan, anomalies] = await Promise.all([
    pool.query(
      `
      SELECT
        COALESCE(SUM(nb_objets_recu), 0)     AS "totalEnvoyes",
        COALESCE(SUM(nb_objets_acceptes), 0) AS "totalValides",
        COALESCE(SUM(nb_objets_refuses), 0)  AS "totalRejetes"
      FROM parcellaire_import
      WHERE organisme_certificateur = $1
        AND status = 'DONE'
        AND created_at >= DATE_TRUNC('week', NOW())
      `,
      [organismeCertificateur]
    ),

    pool.query(
      `
      SELECT pil.code, COUNT(*) AS count
      FROM parcellaire_import_logs pil
      JOIN parcellaire_import pi ON pi.id = pil.import_id
      WHERE pi.organisme_certificateur = $1
        AND pil.type = 'error'
        AND pi.created_at >= DATE_TRUNC('week', NOW())
      GROUP BY pil.code
      ORDER BY count DESC
      LIMIT 1
      `,
      [organismeCertificateur]
    )
  ])

  const b = bilan.rows[0]

  return {
    totalEnvoyes: Number(b.totalEnvoyes),
    totalValides: Number(b.totalValides),
    totalRejetes: Number(b.totalRejetes),
    anomaliePlusFrequente: anomalies.rows[0]
      ? { code: anomalies.rows[0].code, count: Number(anomalies.rows[0].count) }
      : null
  }
}

async function getTableauBilanRepo (organismeCertificateur, { from, to, errorOnly, page, limit }) {
  const conditions = ['pi.organisme_certificateur = $1']
  const params = [organismeCertificateur]
  let i = 2

  if (from) {
    conditions.push(`pi.created_at >= $${i++}`)
    params.push(new Date(from))
  }

  if (to) {
    conditions.push(`pi.created_at <= $${i++}`)
    params.push(new Date(`${to}T23:59:59`))
  }

  if (errorOnly) {
    conditions.push('pi.nb_objets_refuses > 0')
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const offset = (page - 1) * limit

  const [rows, count] = await Promise.all([
    pool.query(
      `
      SELECT
        pi.id AS "jobId",
        pi.organisme_certificateur,
        pi.status,
        pi.created_at,
        pi.nb_objets_recu,
        pi.nb_objets_acceptes,
        pi.nb_objets_refuses
      FROM parcellaire_import pi
      ${where}
      ORDER BY pi.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
      `,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*) FROM parcellaire_import pi ${where}`, params)
  ])

  return {
    data: rows.rows.map(r => ({
      jobId: r.jobId,
      organismeCertificateur: r.organisme_certificateur,
      statut: r.status,
      createdAt: r.created_at,
      nbObjetsRecus: toNumber(r.nb_objets_recu),
      nbObjetsAcceptes: toNumber(r.nb_objets_acceptes),
      nbObjetsRefuses: toNumber(r.nb_objets_refuses)
    })),
    meta: {
      total: Number(count.rows[0].count),
      page,
      limit
    }
  }
}

async function getHistoriqueImportsRepo (organismeCertificateur, { from, to, page, limit }) {
  const conditions = ['organisme_certificateur = $1']
  const params = [organismeCertificateur]
  let i = 2

  if (from) {
    conditions.push(`created_at >= $${i++}`)
    params.push(new Date(from))
  }

  if (to) {
    conditions.push(`created_at <= $${i++}`)
    params.push(new Date(`${to}T23:59:59`))
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const offset = (page - 1) * limit

  const [rows, count] = await Promise.all([
    pool.query(
      `
      SELECT
        id AS "jobId",
        status,
        created_at,
        ended_at,
        nb_objets_recu,
        nb_objets_acceptes,
        nb_objets_refuses
      FROM parcellaire_import
      ${where}
      ORDER BY created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
      `,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*) FROM parcellaire_import ${where}`, params)
  ])

  return {
    data: rows.rows.map(r => ({
      jobId: r.jobId,
      statut: r.status,
      createdAt: r.created_at,
      endedAt: r.ended_at,
      nbObjetsRecus: toNumber(r.nb_objets_recu),
      nbObjetsAcceptes: toNumber(r.nb_objets_acceptes),
      nbObjetsRefuses: toNumber(r.nb_objets_refuses)
    })),
    meta: {
      total: Number(count.rows[0].count),
      page,
      limit
    }
  }
}

async function getPayloadImportRepo (organismeCertificateur, jobId) {
  const { rows } = await pool.query(
    `
    SELECT pip.id, pip.payload
    FROM parcellaire_import_payload pip
    JOIN parcellaire_import pi ON pi.id = pip.import_id
    WHERE pip.import_id = $1
      AND pi.organisme_certificateur = $2
    `,
    [jobId, organismeCertificateur]
  )

  return rows[0] ?? null
}

async function getTableauErreursRepo (organismeCertificateur, { from, to, page, limit }) {
  const conditions = ['pi.organisme_certificateur = $1', 'pi.nb_objets_refuses > 0']
  const params = [organismeCertificateur]
  let i = 2

  if (from) {
    conditions.push(`pi.created_at >= $${i++}`)
    params.push(new Date(from))
  }

  if (to) {
    conditions.push(`pi.created_at <= $${i++}`)
    params.push(new Date(`${to}T23:59:59`))
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const offset = (page - 1) * limit

  const [rows, count] = await Promise.all([
    pool.query(
      `
      SELECT
        pi.id AS "jobId",
        pi.status,
        pi.created_at,
        pi.nb_objets_recu,
        pi.nb_objets_acceptes,
        pi.nb_objets_refuses
      FROM parcellaire_import pi
      ${where}
      ORDER BY pi.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
      `,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*) FROM parcellaire_import pi ${where}`, params)
  ])

  const jobIds = rows.rows.map(r => r.jobId)

  let logsByJobId = {}

  if (jobIds.length > 0) {
    const { rows: logs } = await pool.query(
      `
      SELECT
        import_id,
        numero_bio,
        parcelle_id,
        parcelle_name,
        code,
        message
      FROM parcellaire_import_logs
      WHERE import_id = ANY($1::int[])
        AND type = 'error'
      ORDER BY id ASC
      `,
      [jobIds]
    )

    logsByJobId = logs.reduce((acc, l) => {
      if (!acc[l.import_id]) acc[l.import_id] = []
      acc[l.import_id].push({
        numeroBio: l.numero_bio,
        parcelleId: l.parcelle_id,
        parcelleName: l.parcelle_name,
        code: l.code,
        message: l.message
      })
      return acc
    }, {})
  }

  return {
    data: rows.rows.map(r => ({
      jobId: r.jobId,
      statut: r.status,
      createdAt: r.created_at,
      nbObjetsRecus: toNumber(r.nb_objets_recu),
      nbObjetsAcceptes: toNumber(r.nb_objets_acceptes),
      nbObjetsRefuses: toNumber(r.nb_objets_refuses),
      details: logsByJobId[r.jobId] ?? []
    })),
    meta: {
      total: Number(count.rows[0].count),
      page,
      limit
    }
  }
}

async function getEnvoisRefusesRepo (organismeCertificateur, from, to) {
  const { rows } = await pool.query(
    `
    SELECT
      pi.id AS "jobId",
      pi.created_at,
      pi.nb_objets_recu,
      pi.nb_objets_acceptes,
      pi.nb_objets_refuses
    FROM parcellaire_import pi
    WHERE pi.organisme_certificateur = $1
      AND pi.nb_objets_refuses > 0
      AND pi.created_at >= $2
      AND pi.created_at <= $3
    ORDER BY pi.created_at DESC
    `,
    [organismeCertificateur, from, to]
  )

  const jobIds = rows.map(r => r.jobId)

  let anomaliesByJobId = {}

  if (jobIds.length > 0) {
    const { rows: anomalies } = await pool.query(
      `
      SELECT
        import_id,
        code,
        COUNT(*) AS count
      FROM parcellaire_import_logs
      WHERE import_id = ANY($1::int[])
        AND type = 'error'
      GROUP BY import_id, code
      ORDER BY count DESC
      `,
      [jobIds]
    )

    anomaliesByJobId = anomalies.reduce((acc, a) => {
      if (!acc[a.import_id]) acc[a.import_id] = []
      acc[a.import_id].push({ code: a.code, count: Number(a.count) })
      return acc
    }, {})
  }

  return rows.map(r => ({
    jobId: r.jobId,
    createdAt: r.created_at,
    nbObjetsRecus: toNumber(r.nb_objets_recu),
    nbObjetsAcceptes: toNumber(r.nb_objets_acceptes),
    nbObjetsRefuses: toNumber(r.nb_objets_refuses),
    anomalies: anomaliesByJobId[r.jobId] ?? []
  }))
}

module.exports = {
  getBilanPeriodeRepo,
  getBilanParGranulariteRepo,
  getResumeSemaineRepo,
  getTableauBilanRepo,
  getHistoriqueImportsRepo,
  getPayloadImportRepo,
  getTableauErreursRepo,
  getEnvoisRefusesRepo
}
