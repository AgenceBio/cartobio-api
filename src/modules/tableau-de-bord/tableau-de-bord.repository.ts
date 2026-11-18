import { and, asc, count, desc, eq, exists, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { parcellaireImportLogs, parcellaireImportPayload, parcellairesImport } from '../../database/schema/index.js'
import { getStreaksSuspectes } from './tableau-de-bord.utils.js'
import type {
  GeneralKpiResponse,
  HistoriqueResponse,
  RepetitionsResponse,
  TableauBilanResponse,
  TableauErreursResponse,
  TopAnomaliesGroupedResponse,
  TopAnomaliesResponse
} from '@agencebio/cartobio-types'
import type {
  AlerteSuspecte,
  DateRange,
  ErrorDetail,
  EtatJob,
  GroupeEnvois,
  HistoriqueParams,
  Numeric,
  PaginationParams,
  PeriodeAnomalies,
  StatutJob
} from './tableau-de-bord.types.js'

function organismeCondition(organismeCertificateur?: number): SQL {
  return eq(parcellairesImport.organismeCertificateur, String(organismeCertificateur))
}

function periodConditions({ from, to }: DateRange): SQL[] {
  const conditions: SQL[] = []

  if (from) {
    conditions.push(gte(parcellairesImport.createdAt, new Date(from)))
  }

  if (to) {
    conditions.push(lte(parcellairesImport.createdAt, new Date(to)))
  }

  return conditions
}

function rechercheCondition(recherche?: string): SQL | undefined {
  if (!recherche) {
    return undefined
  }

  return or(
    ilike(parcellairesImport.numeroClient, `%${recherche}%`),
    ilike(parcellairesImport.numeroBio, `%${recherche}%`)
  )
}

async function getErrorLogsByJobId(jobIds: number[]): Promise<Record<number, ErrorDetail[]>> {
  if (jobIds.length === 0) {
    return {}
  }

  const logs = await db
    .select({
      importId: parcellaireImportLogs.importId,
      numeroBio: parcellaireImportLogs.numeroBio,
      parcelleId: parcellaireImportLogs.parcelleId,
      parcelleName: parcellaireImportLogs.parcelleName,
      code: parcellaireImportLogs.code,
      message: parcellaireImportLogs.message
    })
    .from(parcellaireImportLogs)
    .where(and(inArray(parcellaireImportLogs.importId, jobIds), eq(parcellaireImportLogs.type, 'error')))
    .orderBy(asc(parcellaireImportLogs.id))

  const logsByJobId: Record<number, ErrorDetail[]> = {}

  for (const { importId, ...detail } of logs) {
    logsByJobId[importId] ??= []
    logsByJobId[importId].push(detail)
  }

  return logsByJobId
}

async function getGeneralKpi({ from, to, organismeCertificateur }: DateRange): Promise<GeneralKpiResponse['data']> {
  const [[bilanRow], [anomalyRow]] = await Promise.all([
    db
      .select({
        totalEnvoyes: sql<Numeric>`COALESCE(SUM((${parcellairesImport.resultJob}->>'count')::int), 0)`,
        totalValides: sql<Numeric>`COALESCE(SUM(jsonb_array_length(${parcellairesImport.resultJob}->'numeroBioValid')), 0)`,
        totalRejetes: sql<Numeric>`COALESCE(SUM(jsonb_array_length(${parcellairesImport.resultJob}->'numeroBioError')), 0)`
      })
      .from(parcellairesImport)
      .where(
        and(
          eq(parcellairesImport.status, 'DONE'),
          ...periodConditions({ from, to }),
          organismeCondition(organismeCertificateur)
        )
      ),

    db
      .select({
        code: parcellaireImportLogs.code,
        count: count()
      })
      .from(parcellaireImportLogs)
      .innerJoin(parcellairesImport, eq(parcellairesImport.id, parcellaireImportLogs.importId))
      .where(
        and(
          eq(parcellaireImportLogs.type, 'error'),
          ...periodConditions({ from, to }),
          organismeCondition(organismeCertificateur)
        )
      )
      .groupBy(parcellaireImportLogs.code)
      .orderBy(desc(count()))
      .limit(1)
  ])

  return {
    totalEnvoyes: Number(bilanRow.totalEnvoyes),
    totalValides: Number(bilanRow.totalValides),
    totalRejetes: Number(bilanRow.totalRejetes),
    anomaliePlusFrequente: anomalyRow
      ? {
          code: anomalyRow.code,
          count: anomalyRow.count
        }
      : null
  }
}

async function getTableauBilanRepo({
  from,
  to,
  organismeCertificateur,
  page,
  limit,
  recherche,
  statuts,
  etats,
  ordreDate
}: PaginationParams): Promise<TableauBilanResponse> {
  const where = and(
    organismeCondition(organismeCertificateur),
    ...periodConditions({ from, to }),
    rechercheCondition(recherche),
    statuts?.length ? inArray(parcellairesImport.statutJob, statuts as StatutJob[]) : undefined,
    etats?.length ? inArray(parcellairesImport.etat, etats as EtatJob[]) : undefined
  )

  const ordre = ordreDate === 'asc' ? asc : desc

  const [rows, total] = await Promise.all([
    db
      .select({
        jobId: parcellairesImport.id,
        numeroClient: parcellairesImport.numeroClient,
        numeroBio: parcellairesImport.numeroBio,
        auditDate: parcellairesImport.auditDate,
        statut: parcellairesImport.statutJob,
        etat: parcellairesImport.etat,
        createdAt: parcellairesImport.createdAt
      })
      .from(parcellairesImport)
      .where(where)
      .orderBy(ordre(parcellairesImport.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),

    db.$count(parcellairesImport, where)
  ])

  return {
    data: rows,
    meta: {
      total,
      page,
      limit
    }
  }
}

async function getTableauErreursRepo({
  from,
  to,
  page,
  limit,
  recherche,
  ordreDate,
  codes,
  organismeCertificateur
}: PaginationParams): Promise<TableauErreursResponse> {
  const where = and(
    eq(parcellairesImport.statutJob, 'REJECTED'),
    organismeCondition(organismeCertificateur),
    ...periodConditions({ from, to }),
    rechercheCondition(recherche),
    codes?.length
      ? exists(
          db
            .select({ id: parcellaireImportLogs.id })
            .from(parcellaireImportLogs)
            .where(
              and(
                eq(parcellaireImportLogs.importId, parcellairesImport.id),
                eq(parcellaireImportLogs.type, 'error'),
                inArray(parcellaireImportLogs.code, codes)
              )
            )
        )
      : undefined
  )

  const ordre = ordreDate === 'asc' ? asc : desc

  const [rows, total] = await Promise.all([
    db
      .select({
        jobId: parcellairesImport.id,
        statut: parcellairesImport.statutJob,
        etat: parcellairesImport.etat,
        numeroBio: parcellairesImport.numeroBio,
        numeroClient: parcellairesImport.numeroClient,
        auditDate: parcellairesImport.auditDate,
        createdAt: parcellairesImport.createdAt
      })
      .from(parcellairesImport)
      .where(where)
      .orderBy(ordre(parcellairesImport.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),

    db.$count(parcellairesImport, where)
  ])

  const logsByJobId = await getErrorLogsByJobId(rows.map((row) => row.jobId))

  return {
    data: rows.map((row) => ({
      ...row,
      details: logsByJobId[row.jobId] ?? []
    })),
    meta: {
      total,
      page,
      limit
    }
  }
}

async function getHistoriqueSpecificParcellaireRepo({
  numeroBio,
  numeroClient,
  auditDate,
  organismeCertificateur
}: HistoriqueParams): Promise<HistoriqueResponse> {
  const rows = await db
    .select({
      jobId: parcellairesImport.id,
      statut: parcellairesImport.statutJob,
      etat: parcellairesImport.etat,
      createdAt: parcellairesImport.createdAt
    })
    .from(parcellairesImport)
    .where(
      and(
        organismeCondition(organismeCertificateur),
        numeroBio ? eq(parcellairesImport.numeroBio, numeroBio) : undefined,
        numeroClient ? eq(parcellairesImport.numeroClient, numeroClient) : undefined,
        auditDate ? eq(parcellairesImport.auditDate, auditDate) : undefined
      )
    )
    .orderBy(desc(parcellairesImport.createdAt))

  const jobIds = rows.map((row) => row.jobId)

  const [logsByJobId, payloads] = await Promise.all([
    getErrorLogsByJobId(jobIds),
    jobIds.length > 0
      ? db
          .select({
            importId: parcellaireImportPayload.importId,
            payload: parcellaireImportPayload.payload
          })
          .from(parcellaireImportPayload)
          .where(inArray(parcellaireImportPayload.importId, jobIds))
      : []
  ])

  const payloadByJobId: Record<number, unknown> = {}

  for (const { importId, payload } of payloads) {
    payloadByJobId[importId] = payload
  }

  return rows.map((row) => ({
    ...row,
    payload: payloadByJobId[row.jobId] ?? null,
    erreurs: logsByJobId[row.jobId] ?? []
  }))
}

function getTruncate(from: string, to: string): 'day' | 'week' {
  const diffInDays = (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)

  return diffInDays <= 7 ? 'day' : 'week'
}

async function getTopAnomaliesRepo({ from, to, organismeCertificateur }: DateRange): Promise<TopAnomaliesResponse['data']> {
  if (!from || !to) {
    return []
  }

  const period = sql<Date>`date_trunc(${sql.raw(`'${getTruncate(from, to)}'`)}, ${parcellairesImport.createdAt})`.mapWith(
    parcellairesImport.createdAt
  )

  const rows = await db
    .select({
      period,
      code: parcellaireImportLogs.code,
      count: count()
    })
    .from(parcellaireImportLogs)
    .innerJoin(parcellairesImport, eq(parcellairesImport.id, parcellaireImportLogs.importId))
    .where(
      and(
        eq(parcellaireImportLogs.type, 'error'),
        ...periodConditions({ from, to }),
        organismeCondition(organismeCertificateur)
      )
    )
    .groupBy(period, parcellaireImportLogs.code)
    .orderBy(period, desc(count()))

  return rows
}

async function getTopAnomaliesGroupedRepo({ from, to, organismeCertificateur }: DateRange): Promise<TopAnomaliesGroupedResponse> {
  if (!from || !to) {
    return []
  }

  const truncate = getTruncate(from, to)
  const unit = sql.raw(`'${truncate}'`)
  const interval = sql.raw(truncate === 'day' ? "'1 day'" : "'1 week'")
  const periodOfImport = sql<Date>`date_trunc(${unit}, ${parcellairesImport.createdAt})`

  const periodsCte = db
    .$with('periods')
    .as(
      db
        .select({ period: sql<Date>`period`.mapWith(parcellairesImport.createdAt).as('period') })
        .from(
          sql`generate_series(date_trunc(${unit}, ${from}::timestamptz), date_trunc(${unit}, ${to}::timestamptz), ${interval}::interval) AS period`
        )
    )

  const importStats = db.$with('import_stats').as(
    db
      .select({
        period: periodOfImport.as('period'),
        accepted: sql<number>`COUNT(*) FILTER (WHERE ${eq(parcellairesImport.statutJob, 'VALID')})`.as('accepted'),
        refused:
          sql<number>`COUNT(*) FILTER (WHERE ${inArray(parcellairesImport.statutJob, ['REJECTED', 'ERROR'])})`.as(
            'refused'
          )
      })
      .from(parcellairesImport)
      .where(and(...periodConditions({ from, to }), organismeCondition(organismeCertificateur)))
      .groupBy(periodOfImport)
  )

  const errorStats = db.$with('error_stats').as(
    db
      .select({
        period: periodOfImport.as('period'),
        code: parcellaireImportLogs.code,
        count: count().as('count')
      })
      .from(parcellaireImportLogs)
      .innerJoin(parcellairesImport, eq(parcellairesImport.id, parcellaireImportLogs.importId))
      .where(
        and(
          eq(parcellaireImportLogs.type, 'error'),
          ...periodConditions({ from, to }),
          organismeCondition(organismeCertificateur)
        )
      )
      .groupBy(periodOfImport, parcellaireImportLogs.code)
  )

  const errorCount = sql<number>`COALESCE(${errorStats.count}, 0)`.mapWith(Number)

  const rows = await db
    .with(periodsCte, importStats, errorStats)
    .select({
      period: periodsCte.period,
      accepted: sql<number>`COALESCE(${importStats.accepted}, 0)`.mapWith(Number),
      refused: sql<number>`COALESCE(${importStats.refused}, 0)`.mapWith(Number),
      code: errorStats.code,
      errorCount
    })
    .from(periodsCte)
    .leftJoin(importStats, eq(importStats.period, periodsCte.period))
    .leftJoin(errorStats, eq(errorStats.period, periodsCte.period))
    .orderBy(asc(periodsCte.period), desc(errorCount))

  const periods = new Map<string, PeriodeAnomalies>()

  for (const row of rows) {
    const key = new Date(row.period).toISOString()

    if (!periods.has(key)) {
      periods.set(key, {
        period: row.period,
        accepted: row.accepted,
        refused: row.refused,
        errorCount: 0,
        errors: []
      })
    }

    const currentPeriod = periods.get(key)

    if (!currentPeriod) {
      continue
    }

    if (row.code) {
      currentPeriod.errors.push({
        code: row.code,
        count: row.errorCount
      })

      currentPeriod.errorCount += row.errorCount
    }
  }

  return Array.from(periods.values())
}

async function getEnvoisSuspectsRepo({
  from,
  to,
  page,
  limit,
  recherche,
  type,
  organismeCertificateur
}: PaginationParams): Promise<RepetitionsResponse> {
  const rows = await db
    .select({
      jobId: parcellairesImport.id,
      numeroBio: parcellairesImport.numeroBio,
      numeroClient: parcellairesImport.numeroClient,
      auditDate: parcellairesImport.auditDate,
      statut: parcellairesImport.statutJob,
      etat: parcellairesImport.etat,
      createdAt: parcellairesImport.createdAt
    })
    .from(parcellairesImport)
    .where(
      and(organismeCondition(organismeCertificateur), ...periodConditions({ from, to }), rechercheCondition(recherche))
    )
    .orderBy(
      parcellairesImport.numeroBio,
      parcellairesImport.numeroClient,
      parcellairesImport.auditDate,
      asc(parcellairesImport.createdAt)
    )

  const logsByJobId = await getErrorLogsByJobId(rows.map((row) => row.jobId))

  const groupes = new Map<string, GroupeEnvois>()

  for (const row of rows) {
    const key = `${row.numeroBio}|${row.numeroClient}|${row.auditDate}`

    if (!groupes.has(key)) {
      groupes.set(key, {
        numeroBio: row.numeroBio,
        numeroClient: row.numeroClient,
        auditDate: row.auditDate,
        envois: []
      })
    }

    groupes.get(key)?.envois.push({
      jobId: row.jobId,
      statut: row.statut,
      etat: row.etat,
      createdAt: row.createdAt,
      erreurs: logsByJobId[row.jobId] ?? []
    })
  }

  const alertes: AlerteSuspecte[] = []

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
