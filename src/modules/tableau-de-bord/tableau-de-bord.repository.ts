import { and, asc, count, desc, eq, exists, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db, firstRow } from '../../database/database.js'
import { parcellaireImportLogs, parcellaireImportPayload, parcellaireImport } from '../../database/schema/index.js'
import {
  importJobResultEnumSchema,
  importLogTypeEnumSchema,
  importStatusEnumSchema
} from '../../database/validations/imports.js'
import { getTruncate } from './tableau-de-bord.utils.js'
import { toIsoDateTime } from '@agencebio/cartobio-types'
import { isoDay, isoTimestamp } from '../../shared/parcellaires/parcellaires.utils.js'
import type {
  GeneralKpiResponse,
  HistoriqueResponse,
  TableauBilanResponse,
  TableauErreursResponse,
  TopAnomaliesResponse
} from '@agencebio/cartobio-types'
import type {
  AnomaliesPeriodeRow,
  DateRange,
  EnvoiParcellaire,
  ErrorDetail,
  HistoriqueParams,
  Numeric,
  PaginationParams,
  PeriodeObligatoire
} from './tableau-de-bord.types.js'

function organismeCondition(organismeCertificateur: number): SQL {
  return eq(parcellaireImport.organismeCertificateur, organismeCertificateur)
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

async function findErrorLogsByJobId(jobIds: number[]): Promise<Record<number, ErrorDetail[]>> {
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
        inArray(parcellaireImportLogs.importId, jobIds),
        eq(parcellaireImportLogs.type, importLogTypeEnumSchema.enum.error)
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

export async function findGeneralKpi({
  from,
  to,
  organismeCertificateur
}: DateRange): Promise<GeneralKpiResponse['data']> {
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
          eq(parcellaireImportLogs.type, importLogTypeEnumSchema.enum.error),
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

export async function findTableauBilan({
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

export async function findTableauErreurs({
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
                eq(parcellaireImportLogs.type, importLogTypeEnumSchema.enum.error),
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

  const logsByJobId = await findErrorLogsByJobId(rows.map((row) => row.jobId))

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

export async function findHistoriqueParcellaire({
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
    findErrorLogsByJobId(jobIds),
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

export async function findTopAnomalies({
  from,
  to,
  organismeCertificateur
}: PeriodeObligatoire): Promise<TopAnomaliesResponse['data']> {
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
        eq(parcellaireImportLogs.type, importLogTypeEnumSchema.enum.error),
        ...periodConditions({ from, to }),
        organismeCondition(organismeCertificateur)
      )
    )
    .groupBy(period, parcellaireImportLogs.code)
    .orderBy(period, desc(count()))

  return rows.map((row) => ({ ...row, period: toIsoDateTime(row.period) }))
}

export async function findTopAnomaliesGrouped({
  from,
  to,
  organismeCertificateur
}: PeriodeObligatoire): Promise<AnomaliesPeriodeRow[]> {
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
          eq(parcellaireImportLogs.type, importLogTypeEnumSchema.enum.error),
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
      accepted: importStats.accepted,
      refused: importStats.refused,
      code: errorStats.code,
      errorCount
    })
    .from(periodsCte)
    .leftJoin(importStats, eq(importStats.period, periodsCte.period))
    .leftJoin(errorStats, eq(errorStats.period, periodsCte.period))
    .orderBy(asc(periodsCte.period), desc(errorCount))

  return rows.map((row) => ({ ...row, accepted: Number(row.accepted ?? 0), refused: Number(row.refused ?? 0) }))
}

export async function findEnvois({
  from,
  to,
  recherche,
  organismeCertificateur
}: PeriodeObligatoire & Pick<PaginationParams, 'recherche'>): Promise<EnvoiParcellaire[]> {
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

  const logsByJobId = await findErrorLogsByJobId(rows.map((row) => row.jobId))

  return rows.map((row) => ({ ...row, erreurs: logsByJobId[row.jobId] ?? [] }))
}
