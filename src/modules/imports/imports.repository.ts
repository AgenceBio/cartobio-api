import type { ImportLogCode } from '@agencebio/cartobio-types'
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db, firstRow } from '../../database/database.js'
import {
  organismeCertificateur,
  parcellaireImportLogs,
  parcellaireImportPayload,
  parcellaires,
  parcellaireImport,
  parcellairesMetadata
} from '../../database/schema/index.js'
import {
  createImportJobSchema,
  createImportLogSchema,
  createImportPayloadSchema,
  importJobEtatEnumSchema,
  importJobResultEnumSchema,
  importStatusEnumSchema,
  updateImportJobSchema
} from '../../database/validations/imports.js'
import type { ImportJobResult, ImportStatus } from '../../database/validations/imports.js'
import type { DBOperatorRecord } from '../../shared/parcellaires/parcellaires.types.js'
import { isoDay } from '../../shared/parcellaires/parcellaires.utils.js'
import { importJobColumns, operatorRecordColumns, operatorRecordConditions, payloadColumn } from './imports.utils.js'
import type {
  ImportJobListRow,
  ImportJobRecordInfos,
  ImportJobRow,
  ImportListFilters,
  OperatorRecordFilters
} from './imports.types.js'

async function completeImportJob({
  result,
  jobId,
  statutJob = null
}: {
  result: unknown
  jobId: string | number
  statutJob?: ImportJobResult | null
}): Promise<number> {
  const { id } = firstRow(
    await db
      .update(parcellaireImport)
      .set({
        ...updateImportJobSchema.parse({
          resultJob: result,
          status: importStatusEnumSchema.enum.DONE,
          ...(statutJob ? { statutJob } : {})
        }),
        endedAt: sql`now()`
      })
      .where(eq(parcellaireImport.id, Number(jobId)))
      .returning({ id: parcellaireImport.id })
  )

  return id
}

async function insertImportLog(
  importId: string | number,
  {
    numeroBio,
    idParcelle = null,
    nomParcelle = null,
    type,
    code,
    message
  }: {
    numeroBio?: string
    idParcelle?: string | number | null
    nomParcelle?: string | null
    type: 'warning' | 'error'
    code: ImportLogCode
    message: string
  }
): Promise<void> {
  await db.insert(parcellaireImportLogs).values(
    createImportLogSchema.parse({
      importId: Number(importId),
      numeroBio,
      parcelleId: idParcelle === null ? null : String(idParcelle),
      parcelleName: nomParcelle,
      type,
      code,
      message
    })
  )
}

async function insertImportJob(organismeCertificateurId: number): Promise<number> {
  const { id } = firstRow(
    await db
      .insert(parcellaireImport)
      .values(
        createImportJobSchema.parse({
          status: importStatusEnumSchema.enum.CREATED,
          organismeCertificateur: organismeCertificateurId
        })
      )
      .returning({ id: parcellaireImport.id })
  )

  return id
}

async function insertPayload(jobId: string | number, payload: unknown): Promise<void> {
  await db
    .insert(parcellaireImportPayload)
    .values(createImportPayloadSchema.parse({ id: randomUUID(), importId: Number(jobId), payload }))
}

/**
 * Renseigne les informations du record et détermine s'il s'agit d'une création
 * ou de la mise à jour d'un parcellaire existant (colonne etat)
 */
async function updateImportJobEtat(
  jobId: string | number,
  { numeroBio, numeroClient, auditDate }: ImportJobRecordInfos
): Promise<void> {
  const parcellaireExistant =
    numeroBio !== null && numeroClient !== null && auditDate !== null
      ? (await db.$count(
          parcellaires,
          and(
            /^\d+$/.test(numeroBio) ? eq(parcellaires.numeroBio, Number(numeroBio)) : sql`false`,
            eq(parcellaires.auditDate, auditDate),
            isNull(parcellaires.deletedAt)
          )
        )) > 0
      : null

  await db
    .update(parcellaireImport)
    .set(
      updateImportJobSchema.parse({
        numeroBio,
        numeroClient,
        auditDate,
        etat:
          parcellaireExistant === null
            ? importJobEtatEnumSchema.enum.UNKNOWN
            : parcellaireExistant
              ? importJobEtatEnumSchema.enum.UPDATED
              : importJobEtatEnumSchema.enum.CREATED
      })
    )
    .where(eq(parcellaireImport.id, Number(jobId)))
}

async function updateImportJobResult(jobId: string | number, statutJob: ImportJobResult): Promise<void> {
  await db
    .update(parcellaireImport)
    .set(updateImportJobSchema.parse({ statutJob }))
    .where(eq(parcellaireImport.id, Number(jobId)))
}

async function updateImportJobError(jobId: string | number, result: { name: string; message: string }): Promise<void> {
  await db
    .update(parcellaireImport)
    .set({
      ...updateImportJobSchema.parse({
        status: importStatusEnumSchema.enum.ERROR,
        statutJob: importJobResultEnumSchema.enum.ERROR,
        resultJob: result
      }),
      endedAt: sql`now()`
    })
    .where(eq(parcellaireImport.id, Number(jobId)))
}

async function failInterruptedImportJobs(): Promise<number> {
  const { rowCount } = await db
    .update(parcellaireImport)
    .set({
      ...updateImportJobSchema.parse({
        status: importStatusEnumSchema.enum.ERROR,
        statutJob: importJobResultEnumSchema.enum.ERROR,
        resultJob: { name: 'InterruptedJob', message: "Le traitement de l'import a été interrompu." }
      }),
      endedAt: sql`now()`
    })
    .where(
      and(
        inArray(parcellaireImport.status, [importStatusEnumSchema.enum.CREATED, importStatusEnumSchema.enum.PENDING]),
        lte(parcellaireImport.createdAt, sql`now() - interval '1 hour'`)
      )
    )
  return rowCount ?? 0
}

async function findImportJob(id: string | number, organisme: number): Promise<ImportJobRow | null> {
  const [job] = await db
    .select({
      status: parcellaireImport.status,
      numerobio: parcellaireImport.numeroBio,
      numeroclient: parcellaireImport.numeroClient,
      audit_date: isoDay(parcellaireImport.auditDate),
      result_job: parcellaireImport.resultJob,
      ended_at: parcellaireImport.endedAt,
      created_at: parcellaireImport.createdAt
    })
    .from(parcellaireImport)
    .where(and(eq(parcellaireImport.id, Number(id)), eq(parcellaireImport.organismeCertificateur, organisme)))

  return job ?? null
}

async function updateImportJobStatusResult(
  jobId: string | number,
  status: ImportStatus,
  result?: Record<string, unknown>
): Promise<void> {
  await db
    .update(parcellaireImport)
    .set({
      ...updateImportJobSchema.parse({ status, resultJob: result ?? {} }),
      ...(status === importStatusEnumSchema.enum.DONE || status === importStatusEnumSchema.enum.ERROR
        ? { endedAt: sql`now()` }
        : {})
    })
    .where(eq(parcellaireImport.id, Number(jobId)))
}

async function findImportList({
  status,
  organismeCertificateur: organisme,
  from,
  to,
  payload,
  withRejected,
  page,
  limit
}: ImportListFilters): Promise<{ rows: ImportJobListRow[]; total: number }> {
  const conditions: SQL[] = []

  if (status) {
    const statuts = status.split(',').map((value) => value.trim().toUpperCase())
    conditions.push(
      inArray(
        parcellaireImport.status,
        importStatusEnumSchema.options.filter((value) => statuts.includes(value))
      )
    )
  }

  if (from) {
    conditions.push(gte(parcellaireImport.createdAt, new Date(from)))
  }

  if (organisme) {
    conditions.push(eq(parcellaireImport.organismeCertificateur, organisme))
  }

  if (to) {
    const end = new Date(to)
    end.setHours(23, 59, 59, 999)
    conditions.push(lte(parcellaireImport.createdAt, end))
  }

  if (withRejected) {
    conditions.push(eq(parcellaireImport.statutJob, importJobResultEnumSchema.enum.REJECTED))
  }

  const includePayload = payload
  const where = and(...conditions)

  const query = db
    .select({ ...importJobColumns, payload: payloadColumn(includePayload) })
    .from(parcellaireImport)
    .$dynamic()

  if (includePayload) {
    query.leftJoin(parcellaireImportPayload, eq(parcellaireImportPayload.importId, parcellaireImport.id))
  }

  const [rows, total] = await Promise.all([
    query
      .where(where)
      .orderBy(desc(parcellaireImport.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.$count(parcellaireImport, where)
  ])

  return { rows, total }
}

async function findImportById(
  id: string | number,
  organisme: number,
  includePayload: boolean
): Promise<ImportJobListRow | null> {
  const query = db
    .select({ ...importJobColumns, started_at: parcellaireImport.startedAt, payload: payloadColumn(includePayload) })
    .from(parcellaireImport)
    .$dynamic()

  if (includePayload) {
    query.leftJoin(parcellaireImportPayload, eq(parcellaireImportPayload.importId, parcellaireImport.id))
  }

  const [row] = await query.where(
    and(eq(parcellaireImport.id, Number(id)), eq(parcellaireImport.organismeCertificateur, organisme))
  )

  return row ?? null
}

async function findLastOperatorRecord(
  numeroBio: string | number,
  { anneeAudit = null, statut = null }: OperatorRecordFilters = {}
): Promise<DBOperatorRecord | null> {
  const [record] = await db
    .select(operatorRecordColumns)
    .from(parcellaires)
    .leftJoin(organismeCertificateur, eq(organismeCertificateur.id, parcellaires.ocId))
    .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
    .where(
      and(
        eq(parcellaires.numeroBio, Number(numeroBio)),
        isNull(parcellaires.deletedAt),
        ...operatorRecordConditions({ anneeAudit, statut })
      )
    )
    .orderBy(desc(parcellaires.updatedAt))
    .limit(1)

  return record ?? null
}

async function findOperatorLastRecords(
  ocId: number,
  {
    anneeAudit = null,
    statut = null,
    anneeReferenceControle = null,
    limit = null,
    start = null
  }: OperatorRecordFilters = {}
): Promise<DBOperatorRecord[]> {
  const query = db
    .selectDistinctOn([parcellaires.numeroBio], operatorRecordColumns)
    .from(parcellaires)
    .leftJoin(organismeCertificateur, eq(organismeCertificateur.id, parcellaires.ocId))
    .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
    .where(
      and(
        eq(parcellaires.ocId, ocId),
        isNull(parcellaires.deletedAt),
        ...operatorRecordConditions({ anneeAudit, statut, anneeReferenceControle })
      )
    )
    .orderBy(asc(parcellaires.numeroBio), desc(parcellaires.updatedAt))
    .$dynamic()

  if (limit !== null) {
    query.limit(limit)
  }

  if (start !== null) {
    query.offset(start)
  }

  return query
}

export {
  completeImportJob,
  insertImportLog,
  insertImportJob,
  insertPayload,
  updateImportJobEtat,
  updateImportJobResult,
  updateImportJobError,
  failInterruptedImportJobs,
  findImportJob,
  updateImportJobStatusResult,
  findImportList,
  findImportById,
  findLastOperatorRecord,
  findOperatorLastRecords
}
