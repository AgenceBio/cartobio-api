import pool from '../../database/database.js'
import { getStreaksSuspectes } from './tableau-de-bord.utils.js'
import type { DateRange, ErrorByCode, ErrorDetail, HistoriqueParams, PaginationParams } from './tableau-de-bord.utils.js'

type Scalar = string | number | Date | string[] | undefined

type Numeric = string | number | null

interface ImportLogRow {
  import_id: number
  numero_bio: string | null
  parcelle_id: string | null
  parcelle_name: string | null
  code: string | null
  message: string | null
}

function toNumber (value: unknown): number | null {
  return value !== null && value !== undefined ? Number(value) : null
}

function groupLogsByJobId (logs: ImportLogRow[]): Record<number, ErrorDetail[]> {
  const logsByJobId: Record<number, ErrorDetail[]> = {}

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

  return logsByJobId
}

async function getGeneralKpi ({ from, to, organismeCertificateur }: DateRange) {
  const [bilan, anomalies] = await Promise.all([
    pool.query<{ totalEnvoyes: Numeric; totalValides: Numeric; totalRejetes: Numeric }>(
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
          AND organisme_certificateur = $3
      `,
      [from, to, organismeCertificateur]
    ),

    pool.query<{ code: string; count: Numeric }>(
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
          AND pi.organisme_certificateur = $3
        GROUP BY pil.code
        ORDER BY count DESC
        LIMIT 1
      `,
      [from, to, organismeCertificateur]
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

async function getTableauBilanRepo ({
  from,
  to,
  organismeCertificateur,
  page,
  limit,
  recherche,
  statuts,
  etats,
  ordreDate
}: PaginationParams) {
  const conditions: string[] = []
  const params: Scalar[] = []
  let index = 2

  conditions.push('pi.organisme_certificateur = $1')
  params.push(organismeCertificateur)

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
    pool.query<{ jobId: number; numeroclient: string | null; numerobio: string | null; audit_date: string | null; statut_job: string | null; etat: string; created_at: Date }>(
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

    pool.query<{ count: Numeric }>(
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

async function getTableauErreursRepo ({
  from,
  to,
  page,
  limit,
  recherche,
  ordreDate,
  codes,
  organismeCertificateur
}: PaginationParams) {
  const conditions = ["pi.statut_job = 'REJECTED'", 'pi.organisme_certificateur = $1']

  const params: Scalar[] = [organismeCertificateur]
  let index = 2

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
    pool.query<{ jobId: number; statut_job: string | null; etat: string; audit_date: string | null; numerobio: string | null; numeroclient: string | null; created_at: Date }>(
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

    pool.query<{ count: Numeric }>(
      `
        SELECT COUNT(*) AS count
        FROM parcellaire_import pi
        ${where}
      `,
      params
    )
  ])

  const jobIds = rows.rows.map((row) => row.jobId)

  let logsByJobId: Record<number, ErrorDetail[]> = {}

  if (jobIds.length > 0) {
    const { rows: logs } = await pool.query<ImportLogRow>(
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

    logsByJobId = groupLogsByJobId(logs)
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

async function getHistoriqueSpecificParcellaireRepo ({
  numeroBio,
  numeroClient,
  auditDate,
  organismeCertificateur
}: HistoriqueParams) {
  const conditions: string[] = []
  const params: Scalar[] = []
  let index = 2

  conditions.push('pi.organisme_certificateur = $1')
  params.push(organismeCertificateur)

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

  const { rows } = await pool.query<{ jobId: number; statut_job: string | null; etat: string; created_at: Date }>(
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

  let logsByJobId: Record<number, ErrorDetail[]> = {}
  const payloadByJobId: Record<number, unknown> = {}

  if (jobIds.length > 0) {
    const [{ rows: logs }, { rows: payloads }] = await Promise.all([
      pool.query<ImportLogRow>(
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

      pool.query<{ import_id: number; payload: unknown }>(
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

    logsByJobId = groupLogsByJobId(logs)

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

function getTruncate (from: string, to: string): 'day' | 'week' {
  const diffInDays =
    (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)

  return diffInDays <= 7 ? 'day' : 'week'
}

async function getTopAnomaliesRepo ({ from, to, organismeCertificateur }: DateRange) {
  if (!from || !to) {
    return []
  }

  const truncate = getTruncate(from, to)

  const { rows } = await pool.query<{ period: Date; code: string | null; count: Numeric }>(
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
        AND pi.organisme_certificateur = $3
      GROUP BY period, pil.code
      ORDER BY period, count DESC
    `,
    [from, to, organismeCertificateur]
  )

  return rows.map((row) => ({
    period: row.period,
    code: row.code,
    count: toNumber(row.count)
  }))
}

async function getTopAnomaliesGroupedRepo ({ from, to, organismeCertificateur }: DateRange) {
  if (!from || !to) {
    return []
  }

  const truncate = getTruncate(from, to)

  const interval = truncate === 'day' ? '1 day' : '1 week'

  const { rows } = await pool.query<{ period: Date; accepted: Numeric; refused: Numeric; code: string | null; error_count: Numeric }>(
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
          AND pi.organisme_certificateur = $3
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
          AND pi.organisme_certificateur = $3
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
    [from, to, organismeCertificateur]
  )

  const periods = new Map<string, {
    period: Date
    accepted: number | null
    refused: number | null
    errorCount: number
    errors: ErrorByCode[]
  }>()

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

async function getEnvoisSuspectsRepo ({
  from,
  to,
  page,
  limit,
  recherche,
  type,
  organismeCertificateur
}: PaginationParams) {
  const conditions: string[] = []
  const params: Scalar[] = []
  let index = 2

  conditions.push('pi.organisme_certificateur = $1')
  params.push(organismeCertificateur)

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

  const { rows } = await pool.query<{ jobId: number; numerobio: string | null; numeroclient: string | null; audit_date: string | null; statut_job: string | null; etat: string; created_at: Date }>(
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

  let logsByJobId: Record<number, ErrorDetail[]> = {}

  if (jobIds.length > 0) {
    const { rows: logs } = await pool.query<ImportLogRow>(
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

    logsByJobId = groupLogsByJobId(logs)
  }

  type Envoi = { jobId: number; statut: string | null; etat: string; createdAt: Date; erreurs: ErrorDetail[] }
  const groupes = new Map<string, { numeroBio: string | null; numeroClient: string | null; auditDate: string | null; envois: Envoi[] }>()

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

  const alertes: Array<{ numeroBio: string | null; numeroClient: string | null; auditDate: string | null; type: 'envois' | 'refus'; envois: Envoi[] }> = []

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

export {
  getGeneralKpi,
  getTableauBilanRepo,
  getTableauErreursRepo,
  getHistoriqueSpecificParcellaireRepo,
  getTopAnomaliesRepo,
  getTopAnomaliesGroupedRepo,
  getEnvoisSuspectsRepo
}
