import { and, asc, count, desc, eq, exists, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db, firstRow } from '../../database/database.js'
import { parcellaireImportLogs, parcellaireImportPayload, parcellaireImport } from '../../database/schema/index.js'
import { importJobResultEnumSchema, importStatusEnumSchema } from '../../database/validations/imports.js'
import { getStreaksSuspectes } from './tableau-de-bord.utils.js'
import { toIsoDateTime } from '@agencebio/cartobio-types'
import { isoDay, isoTimestamp } from '../../shared/parcellaires/parcellaires.utils.js'
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
  GroupeEnvois,
  HistoriqueParams,
  Numeric,
  PaginationParams,
  PeriodeAnomalies
} from './tableau-de-bord.types.js'

function organismeCondition(organismeCertificateur: number): SQL {
  return eq(parcellaireImport.organismeCertificateur, String(organismeCertificateur))
}

function periodConditions({ from, to }: Pick<DateRange, 'from' | 'to'>): SQL[] {
  const conditions: SQL[] = []

  if (from) {
    conditions.push(gte(parcellaireImport.createdAt, new Date(from)))
  }

  if (to) {
    conditions.push(lte(parcellaireImport.createdAt, new Date(to)))
  }

  return conditions
}

function rechercheCondition(recherche?: string): SQL | undefined {
  if (!recherche) {
    return undefined
  }

  const motif = `%${recherche.replace(/[\\%_]/g, '\\$&')}%`
  return or(ilike(parcellaireImport.numeroClient, motif), ilike(parcellaireImport.numeroBio, motif))
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
    .where(
      and(
        sql`${parcellaireImportLogs.importId} = ANY(${sql.param(jobIds)}::int[])`,
        eq(parcellaireImportLogs.type, 'error')
      )
    )
    .orderBy(asc(parcellaireImportLogs.id))

  const logsByJobId: Record<number, ErrorDetail[]> = {}

  for (const { importId, ...detail } of logs) {
    logsByJobId[importId] ??= []
    logsByJobId[importId].push(detail)
  }

  return logsByJobId
}

async function getGeneralKpi({ from, to, organismeCertificateur }: DateRange): Promise<GeneralKpiResponse['data']> {
  const [bilanRows, [anomalyRow]] = await Promise.all([
    db
      .select({
        totalEnvoyes: sql<Numeric>`COALESCE(SUM((${parcellaireImport.resultJob}->>'count')::int), 0)`,
        totalValides: sql<Numeric>`COALESCE(SUM(jsonb_array_length(${parcellaireImport.resultJob}->'numeroBioValid')), 0)`,
        totalRejetes: sql<Numeric>`COALESCE(SUM(jsonb_array_length(${parcellaireImport.resultJob}->'numeroBioError')), 0)`
      })
      .from(parcellaireImport)
      .where(
        and(
          eq(parcellaireImport.status, importStatusEnumSchema.enum.DONE),
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
      .innerJoin(parcellaireImport, eq(parcellaireImport.id, parcellaireImportLogs.importId))
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
  const bilanRow = firstRow(bilanRows)

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
    statuts?.length ? inArray(parcellaireImport.statutJob, statuts) : undefined,
    etats?.length ? inArray(parcellaireImport.etat, etats) : undefined
  )

  const ordre = ordreDate === 'asc' ? asc : desc

  const [rows, total] = await Promise.all([
    db
      .select({
        jobId: parcellaireImport.id,
        numeroClient: parcellaireImport.numeroClient,
        numeroBio: parcellaireImport.numeroBio,
        auditDate: isoDay(parcellaireImport.auditDate),
        statut: parcellaireImport.statutJob,
        etat: parcellaireImport.etat,
        createdAt: isoTimestamp(parcellaireImport.createdAt)
      })
      .from(parcellaireImport)
      .where(where)
      .orderBy(ordre(parcellaireImport.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),

    db.$count(parcellaireImport, where)
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
    eq(parcellaireImport.statutJob, importJobResultEnumSchema.enum.REJECTED),
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
                eq(parcellaireImportLogs.importId, parcellaireImport.id),
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
        jobId: parcellaireImport.id,
        statut: parcellaireImport.statutJob,
        etat: parcellaireImport.etat,
        numeroBio: parcellaireImport.numeroBio,
        numeroClient: parcellaireImport.numeroClient,
        auditDate: isoDay(parcellaireImport.auditDate),
        createdAt: isoTimestamp(parcellaireImport.createdAt)
      })
      .from(parcellaireImport)
      .where(where)
      .orderBy(ordre(parcellaireImport.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),

    db.$count(parcellaireImport, where)
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
      jobId: parcellaireImport.id,
      statut: parcellaireImport.statutJob,
      etat: parcellaireImport.etat,
      createdAt: isoTimestamp(parcellaireImport.createdAt)
    })
    .from(parcellaireImport)
    .where(
      and(
        organismeCondition(organismeCertificateur),
        numeroBio ? eq(parcellaireImport.numeroBio, numeroBio) : undefined,
        numeroClient ? eq(parcellaireImport.numeroClient, numeroClient) : undefined,
        auditDate ? eq(parcellaireImport.auditDate, auditDate) : undefined
      )
    )
    .orderBy(desc(parcellaireImport.createdAt))

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
          .where(sql`${parcellaireImportPayload.importId} = ANY(${sql.param(jobIds)}::int[])`)
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

async function getTopAnomaliesRepo({
  from,
  to,
  organismeCertificateur
}: DateRange): Promise<TopAnomaliesResponse['data']> {
  if (!from || !to) {
    return []
  }

  const period =
    sql<Date>`date_trunc(${sql.raw(`'${getTruncate(from, to)}'`)}, ${parcellaireImport.createdAt})`.mapWith(
      parcellaireImport.createdAt
    )

  const rows = await db
    .select({
      period,
      code: parcellaireImportLogs.code,
      count: count()
    })
    .from(parcellaireImportLogs)
    .innerJoin(parcellaireImport, eq(parcellaireImport.id, parcellaireImportLogs.importId))
    .where(
      and(
        eq(parcellaireImportLogs.type, 'error'),
        ...periodConditions({ from, to }),
        organismeCondition(organismeCertificateur)
      )
    )
    .groupBy(period, parcellaireImportLogs.code)
    .orderBy(period, desc(count()))

  return rows.map((row) => ({ ...row, period: toIsoDateTime(row.period) }))
}

async function getTopAnomaliesGroupedRepo({
  from,
  to,
  organismeCertificateur
}: DateRange): Promise<TopAnomaliesGroupedResponse> {
  if (!from || !to) {
    return []
  }

  const truncate = getTruncate(from, to)
  const unit = sql.raw(`'${truncate}'`)
  const interval = sql.raw(truncate === 'day' ? "'1 day'" : "'1 week'")
  const periodOfImport = sql<Date>`date_trunc(${unit}, ${parcellaireImport.createdAt})`

  const periodsCte = db
    .$with('periods')
    .as(
      db
        .select({ period: sql<Date>`period`.mapWith(parcellaireImport.createdAt).as('period') })
        .from(
          sql`generate_series(date_trunc(${unit}, ${from}::timestamptz), date_trunc(${unit}, ${to}::timestamptz), ${interval}::interval) AS period`
        )
    )

  const importStats = db.$with('import_stats').as(
    db
      .select({
        period: periodOfImport.as('period'),
        accepted:
          sql<number>`COUNT(*) FILTER (WHERE ${eq(parcellaireImport.statutJob, importJobResultEnumSchema.enum.VALID)})`.as(
            'accepted'
          ),
        refused:
          sql<number>`COUNT(*) FILTER (WHERE ${inArray(parcellaireImport.statutJob, [importJobResultEnumSchema.enum.REJECTED, importJobResultEnumSchema.enum.ERROR])})`.as(
            'refused'
          )
      })
      .from(parcellaireImport)
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
      .innerJoin(parcellaireImport, eq(parcellaireImport.id, parcellaireImportLogs.importId))
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
    const key = toIsoDateTime(new Date(row.period))

    let currentPeriod = periods.get(key)

    if (!currentPeriod) {
      currentPeriod = {
        period: key,
        accepted: row.accepted,
        refused: row.refused,
        errorCount: 0,
        errors: []
      }
      periods.set(key, currentPeriod)
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
      jobId: parcellaireImport.id,
      numeroBio: parcellaireImport.numeroBio,
      numeroClient: parcellaireImport.numeroClient,
      auditDate: isoDay(parcellaireImport.auditDate),
      statut: parcellaireImport.statutJob,
      etat: parcellaireImport.etat,
      createdAt: isoTimestamp(parcellaireImport.createdAt)
    })
    .from(parcellaireImport)
    .where(
      and(organismeCondition(organismeCertificateur), ...periodConditions({ from, to }), rechercheCondition(recherche))
    )
    .orderBy(
      parcellaireImport.numeroBio,
      parcellaireImport.numeroClient,
      parcellaireImport.auditDate,
      asc(parcellaireImport.createdAt)
    )

  const logsByJobId = await getErrorLogsByJobId(rows.map((row) => row.jobId))

  const groupes = new Map<string, GroupeEnvois>()

  for (const row of rows) {
    const key = `${row.numeroBio}|${row.numeroClient}|${row.auditDate}`

    let groupe = groupes.get(key)

    if (!groupe) {
      groupe = {
        numeroBio: row.numeroBio,
        numeroClient: row.numeroClient,
        auditDate: row.auditDate,
        envois: []
      }
      groupes.set(key, groupe)
    }

    groupe.envois.push({
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
