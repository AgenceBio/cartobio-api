const pool = require('../../db')
const { getStreaksSuspectes } = require('./utils')

/** @typedef {import('./utils').DateRange} DateRange */
/** @typedef {import('./utils').ErrorByCode} ErrorByCode */
/** @typedef {import('./utils').ErrorDetail} ErrorDetail */
/** @typedef {import('./utils').HistoriqueParams} HistoriqueParams */
/** @typedef {import('./utils').PaginationParams} PaginationParams */

/** @typedef {string | number | Date | string[]} Scalar */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toNumber (value) {
  return value !== null && value !== undefined ? Number(value) : null
}

/**
 * @param {number} totalRecu
 * @param {number} totalRefuses
 * @returns {number}
 */
function getTauxRefus (totalRecu, totalRefuses) {
  return totalRecu > 0 ? Math.round((totalRefuses / totalRecu) * 100) : 0
}

/**
 * @param {string} [from]
 * @param {string} [to]
 * @param {number} [startIndex]
 * @returns {{ conditions: string[]; params: Scalar[]; nextIndex: number }}
 */
function buildDateConditions (
  from,
  to,
  startIndex = 1
) {
  const conditions = []
  const params = []
  let index = startIndex

  if (from) {
    conditions.push(`created_at >= $${index++}`)
    params.push(from)
  }

  if (to) {
    conditions.push(`created_at <= $${index++}`)
    params.push(to)
  }

  return {
    conditions,
    params,
    nextIndex: index
  }
}

/**
 * @param {string} [from]
 * @param {string} [to]
 */
async function queryBilanPeriode (from, to) {
  const { conditions, params } = buildDateConditions(from, to)

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(numerobio), 0) AS "totalRecu",
        COALESCE(
          SUM(jsonb_array_length(result_job->'numeroBioValid')),
          0
        ) AS "totalAcceptes",
        COALESCE(
          SUM(jsonb_array_length(result_job->'numeroBioError')),
          0
        ) AS "totalRefuses"
      FROM parcellaire_import
      ${where}
    `,
    params
  )

  const row = rows[0]

  const totalRecu = Number(row.totalRecu)
  const totalAcceptes = Number(row.totalAcceptes)
  const totalRefuses = Number(row.totalRefuses)

  return {
    totalRecu,
    totalAcceptes,
    totalRefuses,
    tauxRefus: getTauxRefus(totalRecu, totalRefuses)
  }
}

/**
 * @param {string} [from]
 * @param {string} [to]
 */
async function getBilanPeriodeRepo (from, to) {
  return queryBilanPeriode(from, to)
}

/**
 * @param {string} from
 * @param {string} to
 * @param {'day' | 'week' | 'month'} granularity
 */
async function getBilanParGranulariteRepo (
  from,
  to,
  granularity
) {
  const { rows } = await pool.query(
    `
      SELECT
        DATE_TRUNC($1, created_at) AS bucket,
        COALESCE(
          SUM((result_job->>'count')::int),
          0
        ) AS "totalRecu",
        COALESCE(
          SUM(jsonb_array_length(result_job->'numeroBioValid')),
          0
        ) AS "totalAcceptes",
        COALESCE(
          SUM(jsonb_array_length(result_job->'numeroBioError')),
          0
        ) AS "totalRefuses"
      FROM parcellaire_import
      WHERE status = 'DONE'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    [granularity, from, to]
  )

  return rows.map((row) => {
    const totalRecu = Number(row.totalRecu)
    const totalAcceptes = Number(row.totalAcceptes)
    const totalRefuses = Number(row.totalRefuses)

    return {
      bucket: row.bucket,
      totalRecu,
      totalAcceptes,
      totalRefuses,
      tauxRefus: getTauxRefus(totalRecu, totalRefuses)
    }
  })
}

/**
 * @param {DateRange} params
 */
async function getGeneralKpi ({ from, to }) {
  const [bilan, anomalies] = await Promise.all([
    pool.query(
      `
        SELECT
          COALESCE(
            SUM((result_job->>'count')::int),
            0
          ) AS "totalEnvoyes",
          COALESCE(
            SUM(jsonb_array_length(result_job->'numeroBioValid')),
            0
          ) AS "totalValides",
          COALESCE(
            SUM(jsonb_array_length(result_job->'numeroBioError')),
            0
          ) AS "totalRejetes"
        FROM parcellaire_import
        WHERE status = 'DONE'
          AND created_at >= $1
          AND created_at <= $2
      `,
      [from, to]
    ),

    pool.query(
      `
        SELECT
          pil.code,
          COUNT(*) AS count
        FROM parcellaire_import_logs pil
        JOIN parcellaire_import pi
          ON pi.id = pil.import_id
        WHERE pil.type = 'error'
          AND pi.created_at >= $1
          AND pi.created_at <= $2
        GROUP BY pil.code
        ORDER BY count DESC
        LIMIT 1
      `,
      [from, to]
    )
  ])

  const bilanRow = bilan.rows[0]
  const anomalyRow = anomalies.rows[0]

  return {
    totalEnvoyes: Number(bilanRow.totalEnvoyes),
    totalValides: Number(bilanRow.totalValides),
    totalRejetes: Number(bilanRow.totalRejetes),
    anomaliePlusFrequente: anomalyRow
      ? {
          code: anomalyRow.code,
          count: Number(anomalyRow.count)
        }
      : null
  }
}

/**
 * @param {PaginationParams} params
 */
async function getTableauBilanRepo ({
  from,
  to,
  page,
  limit,
  recherche,
  statuts,
  etats,
  ordreDate
}) {
  const conditions = []
  const params = []
  let index = 1

  if (from) {
    conditions.push(`pi.created_at >= $${index++}`)
    params.push(from)
  }

  if (to) {
    conditions.push(`pi.created_at <= $${index++}`)
    params.push(to)
  }

  if (recherche) {
    conditions.push(
      `(pi.numeroclient ILIKE $${index} OR pi.numerobio ILIKE $${index})`
    )
    params.push(`%${recherche}%`)
    index++
  }

  if (statuts && statuts.length > 0) {
    conditions.push(`pi.statut_job = ANY($${index++})`)
    params.push(statuts)
  }

  if (etats && etats.length > 0) {
    conditions.push(`pi.etat = ANY($${index++})`)
    params.push(etats)
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const limitIndex = index++
  const offsetIndex = index++
  const offset = (page - 1) * limit
  const ordreSql = ordreDate === 'asc' ? 'ASC' : 'DESC'

  const [rows, count] = await Promise.all([
    pool.query(
      `
        SELECT
          pi.id AS "jobId",
          pi.numeroclient,
          pi.numerobio,
          pi.audit_date,
          pi.statut_job,
          pi.etat,
          pi.created_at
        FROM parcellaire_import pi
        ${where}
        ORDER BY pi.created_at ${ordreSql}
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
      `,
      [...params, limit, offset]
    ),

    pool.query(
      `
        SELECT COUNT(*) AS count
        FROM parcellaire_import pi
        ${where}
      `,
      params
    )
  ])

  return {
    data: rows.rows.map((row) => ({
      jobId: row.jobId,
      numeroClient: row.numeroclient,
      numeroBio: row.numerobio,
      auditDate: row.audit_date,
      statut: row.statut_job,
      etat: row.etat,
      createdAt: row.created_at
    })),
    meta: {
      total: Number(count.rows[0].count),
      page,
      limit
    }
  }
}

/**
 * @param {PaginationParams} params
 */
async function getHistoriqueImportsRepo ({
  from,
  to,
  page,
  limit
}) {
  const conditions = []
  const params = []
  let index = 1

  if (from) {
    conditions.push(`created_at >= $${index++}`)
    params.push(new Date(from))
  }

  if (to) {
    conditions.push(`created_at <= $${index++}`)
    params.push(new Date(`${to}T23:59:59`))
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const limitIndex = index++
  const offsetIndex = index++
  const offset = (page - 1) * limit

  const [rows, count] = await Promise.all([
    pool.query(
      `
        SELECT
          id AS "jobId",
          status,
          created_at,
          ended_at,
          (result_job->>'count')::int AS nb_objets_recu,
          jsonb_array_length(
            result_job->'numeroBioValid'
          ) AS nb_objets_acceptes,
          jsonb_array_length(
            result_job->'numeroBioError'
          ) AS nb_objets_refuses
        FROM parcellaire_import
        ${where}
        ORDER BY created_at DESC
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
      `,
      [...params, limit, offset]
    ),

    pool.query(
      `
        SELECT COUNT(*) AS count
        FROM parcellaire_import
        ${where}
      `,
      params
    )
  ])

  return {
    data: rows.rows.map((row) => ({
      jobId: row.jobId,
      statut: row.status,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      nbObjetsRecus: toNumber(row.nb_objets_recu),
      nbObjetsAcceptes: toNumber(row.nb_objets_acceptes),
      nbObjetsRefuses: toNumber(row.nb_objets_refuses)
    })),
    meta: {
      total: Number(count.rows[0].count),
      page,
      limit
    }
  }
}

/**
 * @param {number} jobId
 */
async function getPayloadImportRepo (jobId) {
  const { rows } = await pool.query(
    `
      SELECT
        pip.id,
        pip.payload
      FROM parcellaire_import_payload pip
      WHERE pip.import_id = $1
    `,
    [jobId]
  )

  return rows[0] ?? null
}

/**
 * @param {PaginationParams} params
 */
async function getTableauErreursRepo({
  from,
  to,
  page,
  limit,
  recherche,
  ordreDate,
  codes
}) {
  const conditions = ["pi.statut_job = 'REJECTED'"]

  const params = []
  let index = 1

  if (from) {
    conditions.push(`pi.created_at >= $${index++}`)
    params.push(from)
  }

  if (to) {
    conditions.push(`pi.created_at <= $${index++}`)
    params.push(to)
  }

  if (recherche) {
    conditions.push(
      `(pi.numeroclient ILIKE $${index} OR pi.numerobio ILIKE $${index})`
    )
    params.push(`%${recherche}%`)
    index++
  }

  if (codes?.length) {
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM parcellaire_import_logs pil
        WHERE pil.import_id = pi.id
          AND pil.type = 'error'
          AND pil.code = ANY($${index++}::text[])
      )`
    )
    params.push(codes)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const limitIndex = index++
  const offsetIndex = index++
  const offset = (page - 1) * limit
  const orderSql = ordreDate === 'asc' ? 'ASC' : 'DESC'

  const [rows, count] = await Promise.all([
    pool.query(
      `
        SELECT
          pi.id AS "jobId",
          pi.statut_job,
          pi.etat,
          pi.audit_date,
          pi.numerobio,
          pi.numeroclient,
          pi.created_at
        FROM parcellaire_import pi
        ${where}
        ORDER BY pi.created_at ${orderSql}
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
      `,
      [...params, limit, offset]
    ),

    pool.query(
      `
        SELECT COUNT(*) AS count
        FROM parcellaire_import pi
        ${where}
      `,
      params
    )
  ])

  const jobIds = rows.rows.map((row) => row.jobId)

  const logsByJobId = {}

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

    for (const log of logs) {
      if (!logsByJobId[log.import_id]) {
        logsByJobId[log.import_id] = []
      }

      logsByJobId[log.import_id].push({
        numeroBio: log.numero_bio,
        parcelleId: log.parcelle_id,
        parcelleName: log.parcelle_name,
        code: log.code,
        message: log.message
      })
    }
  }

  return {
    data: rows.rows.map((row) => ({
      jobId: row.jobId,
      statut: row.statut_job,
      etat: row.etat,
      numeroBio: row.numerobio,
      numeroClient: row.numeroclient,
      auditDate: row.audit_date,
      createdAt: row.created_at,
      details: logsByJobId[row.jobId] ?? []
    })),
    meta: {
      total: Number(count.rows[0].count),
      page,
      limit
    }
  }
}

/**
 * @param {string} from
 * @param {string} to
 */
async function getEnvoisRefusesRepo (from, to) {
  const { rows } = await pool.query(
    `
      SELECT
        pi.id AS "jobId",
        pi.created_at,
        (pi.result_job->>'count')::int AS nb_objets_recu,
        jsonb_array_length(
          pi.result_job->'numeroBioValid'
        ) AS nb_objets_acceptes,
        jsonb_array_length(
          pi.result_job->'numeroBioError'
        ) AS nb_objets_refuses
      FROM parcellaire_import pi
      WHERE COALESCE(
        jsonb_array_length(
          pi.result_job->'numeroBioError'
        ),
        0
      ) > 0
        AND pi.created_at >= $1
        AND pi.created_at <= $2
      ORDER BY pi.created_at DESC
    `,
    [from, to]
  )

  const jobIds = rows.map((row) => row.jobId)

  const anomaliesByJobId = {}

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

    for (const anomaly of anomalies) {
      if (!anomaliesByJobId[anomaly.import_id]) {
        anomaliesByJobId[anomaly.import_id] = []
      }

      anomaliesByJobId[anomaly.import_id].push({
        code: anomaly.code,
        count: Number(anomaly.count)
      })
    }
  }

  return rows.map((row) => ({
    jobId: row.jobId,
    createdAt: row.created_at,
    nbObjetsRecus: toNumber(row.nb_objets_recu),
    nbObjetsAcceptes: toNumber(row.nb_objets_acceptes),
    nbObjetsRefuses: toNumber(row.nb_objets_refuses),
    anomalies: anomaliesByJobId[row.jobId] ?? []
  }))
}

/**
 * @param {HistoriqueParams} params
 */
async function getHistoriqueSpecificParcellaireRepo ({
  numeroBio,
  numeroClient,
  auditDate
}) {
  const conditions = []
  const params = []
  let index = 1

  if (numeroBio) {
    conditions.push(`pi.numerobio = $${index++}`)
    params.push(numeroBio)
  }

  if (numeroClient) {
    conditions.push(`pi.numeroclient = $${index++}`)
    params.push(numeroClient)
  }

  if (auditDate) {
    conditions.push(`pi.audit_date = $${index++}`)
    params.push(auditDate)
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows } = await pool.query(
    `
      SELECT
        pi.id AS "jobId",
        pi.statut_job,
        pi.etat,
        pi.created_at
      FROM parcellaire_import pi
      ${where}
      ORDER BY pi.created_at DESC
    `,
    params
  )

  const jobIds = rows.map((row) => row.jobId)

  const logsByJobId = {}
  const payloadByJobId = {}

  if (jobIds.length > 0) {
    const [{ rows: logs }, { rows: payloads }] = await Promise.all([
      pool.query(
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
      ),

      pool.query(
        `
            SELECT
              import_id,
              payload
            FROM parcellaire_import_payload
            WHERE import_id = ANY($1::int[])
          `,
        [jobIds]
      )
    ])

    for (const log of logs) {
      if (!logsByJobId[log.import_id]) {
        logsByJobId[log.import_id] = []
      }

      logsByJobId[log.import_id].push({
        numeroBio: log.numero_bio,
        parcelleId: log.parcelle_id,
        parcelleName: log.parcelle_name,
        code: log.code,
        message: log.message
      })
    }

    for (const payload of payloads) {
      payloadByJobId[payload.import_id] = payload.payload
    }
  }

  return rows.map((row) => ({
    jobId: row.jobId,
    statut: row.statut_job,
    etat: row.etat,
    createdAt: row.created_at,
    payload: payloadByJobId[row.jobId] ?? null,
    erreurs: logsByJobId[row.jobId] ?? []
  }))
}

/**
 * @param {DateRange} params
 */
async function getTopAnomaliesRepo ({ from, to }) {
  if (!from || !to) {
    return []
  }

  const diffInDays =
    (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)

  const truncate = diffInDays <= 7 ? 'day' : 'week'

  const { rows } = await pool.query(
    `
      SELECT
        date_trunc('${truncate}', pi.created_at) AS period,
        pil.code,
        COUNT(*) AS count
      FROM parcellaire_import_logs pil
      INNER JOIN parcellaire_import pi
        ON pi.id = pil.import_id
      WHERE pil.type = 'error'
        AND pi.created_at >= $1
        AND pi.created_at <= $2
      GROUP BY period, pil.code
      ORDER BY period, count DESC
    `,
    [from, to]
  )

  return rows.map((row) => ({
    period: row.period,
    code: row.code,
    count: toNumber(row.count)
  }))
}

/**
 * @param {DateRange} params
 */
async function getTopAnomaliesGroupedRepo ({ from, to }) {
  if (!from || !to) {
    return []
  }

  const diffInDays =
    (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)

  const truncate = diffInDays <= 7 ? 'day' : 'week'

  const interval = truncate === 'day' ? '1 day' : '1 week'

  const { rows } = await pool.query(
    `
      WITH periods AS (
        SELECT generate_series(
          date_trunc('${truncate}', $1::timestamptz),
          date_trunc('${truncate}', $2::timestamptz),
          '${interval}'::interval
        ) AS period
      ),

      import_stats AS (
        SELECT
          date_trunc('${truncate}', pi.created_at) AS period,
          COUNT(*) FILTER (
            WHERE pi.statut_job = 'VALID'
          ) AS accepted,
          COUNT(*) FILTER (
            WHERE pi.statut_job IN ('REJECTED', 'ERROR')
          ) AS refused
        FROM parcellaire_import pi
        WHERE pi.created_at >= $1
          AND pi.created_at <= $2
        GROUP BY 1
      ),

      error_stats AS (
        SELECT
          date_trunc('${truncate}', pi.created_at) AS period,
          pil.code,
          COUNT(*) AS count
        FROM parcellaire_import_logs pil
        INNER JOIN parcellaire_import pi
          ON pi.id = pil.import_id
        WHERE pil.type = 'error'
          AND pi.created_at >= $1
          AND pi.created_at <= $2
        GROUP BY 1, 2
      )

      SELECT
        periods.period,
        COALESCE(import_stats.accepted, 0) AS accepted,
        COALESCE(import_stats.refused, 0) AS refused,
        error_stats.code,
        COALESCE(error_stats.count, 0) AS error_count
      FROM periods
      LEFT JOIN import_stats
        ON import_stats.period = periods.period
      LEFT JOIN error_stats
        ON error_stats.period = periods.period
      ORDER BY periods.period ASC, error_count DESC
    `,
    [from, to]
  )

  /**
   * @type {Map<string, {
   *   period: Date;
   *   accepted: number | null;
   *   refused: number | null;
   *   errorCount: number;
   *   errors: ErrorByCode[];
   * }>}
   */
  const periods = new Map()

  for (const row of rows) {
    const key = new Date(row.period).toISOString()

    if (!periods.has(key)) {
      periods.set(key, {
        period: row.period,
        accepted: toNumber(row.accepted),
        refused: toNumber(row.refused),
        errorCount: 0,
        errors: []
      })
    }

    const currentPeriod = periods.get(key)

    if (!currentPeriod) {
      continue
    }

    const count = toNumber(row.error_count)

    if (row.code) {
      currentPeriod.errors.push({
        code: row.code,
        count
      })

      currentPeriod.errorCount += count ?? 0
    }
  }

  return Array.from(periods.values())
}

/**
 * @param {PaginationParams} params
 */
async function getEnvoisSuspectsRepo({
  from,
  to,
  page,
  limit,
  recherche,
  type
}) {
  const conditions = []
  const params = []
  let index = 1

  if (from) {
    conditions.push(`pi.created_at >= $${index++}`)
    params.push(from)
  }

  if (to) {
    conditions.push(`pi.created_at <= $${index++}`)
    params.push(to)
  }

  if (recherche) {
    conditions.push(
      `(pi.numeroclient ILIKE $${index} OR pi.numerobio ILIKE $${index})`
    )
    params.push(`%${recherche}%`)
    index++
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows } = await pool.query(
    `
    SELECT
      pi.id AS "jobId",
      pi.numerobio,
      pi.numeroclient,
      pi.audit_date,
      pi.statut_job,
      pi.etat,
      pi.created_at
    FROM parcellaire_import pi
    ${where}
    ORDER BY
      pi.numerobio,
      pi.numeroclient,
      pi.audit_date,
      pi.created_at ASC
    `,
    params
  )

  const jobIds = rows.map((row) => row.jobId)

  const logsByJobId = {}

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

    for (const log of logs) {
      if (!logsByJobId[log.import_id]) {
        logsByJobId[log.import_id] = []
      }

      logsByJobId[log.import_id].push({
        numeroBio: log.numero_bio,
        parcelleId: log.parcelle_id,
        parcelleName: log.parcelle_name,
        code: log.code,
        message: log.message
      })
    }
  }

  const groupes = new Map()

  for (const row of rows) {
    const key = `${row.numerobio}|${row.numeroclient}|${row.audit_date}`

    if (!groupes.has(key)) {
      groupes.set(key, {
        numeroBio: row.numerobio,
        numeroClient: row.numeroclient,
        auditDate: row.audit_date,
        envois: []
      })
    }

    groupes.get(key)?.envois.push({
      jobId: row.jobId,
      statut: row.statut_job,
      etat: row.etat,
      createdAt: row.created_at,
      erreurs: logsByJobId[row.jobId] ?? []
    })
  }

  // Une alerte PAR SÉRIE : chaque alerte a un type unique
  const alertes = []

  for (const groupe of groupes.values()) {
    for (const streak of getStreaksSuspectes(groupe.envois)) {
      alertes.push({
        numeroBio: groupe.numeroBio,
        numeroClient: groupe.numeroClient,
        auditDate: groupe.auditDate,
        type: streak.type,
        envois: streak.envois
      })
    }
  }

  // Filtre par type, direct maintenant que chaque alerte est homogène
  const alertesFiltrees = type ? alertes.filter((alerte) => alerte.type === type) : alertes

  const total = alertesFiltrees.length
  const offset = (page - 1) * limit

  return {
    data: alertesFiltrees.slice(offset, offset + limit),
    meta: {
      total,
      page,
      limit
    }
  }
}

/**
 * @param {DateRange} params
 */
async function getTopAnomaliesGlobalRepo ({ from, to }) {
  if (!from || !to) {
    return []
  }

  const { rows } = await pool.query(
    `
      SELECT
        pil.code,
        COUNT(*) AS count
      FROM parcellaire_import_logs pil
      INNER JOIN parcellaire_import pi
        ON pi.id = pil.import_id
      WHERE pil.type = 'error'
        AND pi.created_at >= $1
        AND pi.created_at <= $2
      GROUP BY pil.code
      ORDER BY count DESC
      LIMIT 3
    `,
    [from, to]
  )

  return rows.map((row) => ({
    code: row.code,
    count: toNumber(row.count)
  }))
}

module.exports = {
  getBilanPeriodeRepo,
  getBilanParGranulariteRepo,
  getGeneralKpi,
  getTableauBilanRepo,
  getHistoriqueImportsRepo,
  getPayloadImportRepo,
  getTableauErreursRepo,
  getEnvoisRefusesRepo,
  getHistoriqueSpecificParcellaireRepo,
  getTopAnomaliesRepo,
  getTopAnomaliesGroupedRepo,
  getEnvoisSuspectsRepo,
  getTopAnomaliesGlobalRepo
}