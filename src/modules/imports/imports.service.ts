import { ImportLogCode, inputApiRecordBodySchema, toIsoDateTime } from '@agencebio/cartobio-types'
import type { ImportSummary, InputApiRecordBody, OrganismeCertificateur } from '@agencebio/cartobio-types'
import { createOrUpdateOperatorRecord } from '../../shared/parcellaires/parcellaires.service.js'
import * as repository from './imports.repository.js'
import { parseAPIParcellaire } from './sources/api-parcellaire.js'
import { normalizeJobReturn } from './imports.utils.js'
import type { ErrorItem, ImportJobStatusResult, ImportListFilters, ImportWarning, ValidItem } from './imports.types.js'
import {
  importJobResultEnumSchema,
  importLogTypeEnumSchema,
  importStatusEnumSchema
} from '../../database/validations/imports.js'
import type { ImportStatus } from '../../database/validations/imports.js'
import { logger } from '../../config/logger.js'

/**
 * Seule passe de validation : le validItem retourné contient le record déjà parsé et prêt pour l'insert.
 */
export async function collectValidationResult(
  payload: unknown,
  { organismeCertificateur }: { organismeCertificateur: OrganismeCertificateur },
  jobId: number
): Promise<{ errors: ErrorItem[]; validItem: ValidItem | null }> {
  const parsed = inputApiRecordBodySchema.safeParse(payload)
  if (!parsed.success) {
    await repository.insertPayload(jobId, payload)
    return {
      errors: parsed.error.issues.map((issue) => ({
        code: ImportLogCode.INVALID_FORMAT,
        message: `${issue.path.length ? `champ ${issue.path.join('.')} incorrect` : 'corps de la requête incorrect'} : ${issue.message}`
      })),
      validItem: null
    }
  }

  const json = parsed.data
  await updateStatus(jobId, json)
  const {
    record,
    numeroBio,
    errors: recordErrors,
    warnings
  } = await parseAPIParcellaire(json, { organismeCertificateur })
  await repository.insertPayload(jobId, json)

  if (recordErrors?.length || !record) {
    return { errors: (recordErrors ?? []).map((err) => ({ numeroBio, ...err })), validItem: null }
  }

  return { errors: [], validItem: { record, numeroBio, warnings: warnings ?? [] } }
}

/**
 * Insère en base de données l'enregistrement déjà validé.
 * Ne refait aucune validation métier : collecte uniquement les warnings post-insert
 * (corrections géométriques) et met à jour le job.
 */
async function parcellaireValidItemToDb(
  { record, numeroBio, warnings }: ValidItem,
  jobId: number
): Promise<{
  count: number
  errors: Array<{ numeroBio?: string; code: ImportLogCode; message: string }>
  warning: Array<[string, ImportWarning[]]>
  numeroBioValid: Array<{ numeroBio: string; nbParcelles: number }>
  numeroBioError: Array<string | undefined>
}> {
  const count = 1
  const dbErrors: Array<{ numeroBio?: string; code: ImportLogCode; message: string }> = []
  const warning: Array<[string, ImportWarning[]]> = []
  const numeroBioError: Array<string | undefined> = []
  const numeroBioValid: Array<{ numeroBio: string; nbParcelles: number }> = []

  if (warnings.length > 0) {
    warning.push([numeroBio, warnings])
  }

  try {
    const { parcelles } = await createOrUpdateOperatorRecord(record, null)
    const parcellesCorrigees = parcelles
      .filter((f) => f.statut_import_geom === 'CORRIGE')
      .map((f) => f.id)
      .filter(Boolean)

    const parcellesNonCorrigees = parcelles
      .filter((f) => f.statut_import_geom === 'ACCEPTENONCORRIGE')
      .map((f) => f.id)
      .filter(Boolean)

    const correctionWarnings: ImportWarning[] = []
    if (parcellesCorrigees.length > 0) {
      correctionWarnings.push({
        numeroBio,
        message: `Ces parcelles ont été corrigées : ${parcellesCorrigees.join(', ')}`,
        code: ImportLogCode.GEOM_CORRECTED
      })
    }

    if (parcellesNonCorrigees.length > 0) {
      correctionWarnings.push({
        numeroBio,
        message: `Ces parcelles n'ont pas été corrigées mais sont invalides : ${parcellesNonCorrigees.join(', ')}`,
        code: ImportLogCode.GEOM_INVALID_NOT_CORRECTED
      })
    }

    if (correctionWarnings.length > 0) {
      warning.push([numeroBio, correctionWarnings])
    }

    numeroBioValid.push({
      numeroBio: record.numerobio,
      nbParcelles: record.parcelles.features.length
    })
  } catch (e) {
    const apiError = e as { code?: string; message?: string }
    if (apiError.code === 'INVALID_API_REQUEST' || apiError.code === 'MISSING_GEOMETRY') {
      dbErrors.push({
        numeroBio: record.numerobio,
        message: apiError.message || 'Erreur de validation lors de l’import.',
        code: apiError.code === 'MISSING_GEOMETRY' ? ImportLogCode.MISSING_GEOM : ImportLogCode.DB_ERROR
      })
      numeroBioError.push(record.numerobio)
    } else {
      throw e
    }
  }

  const importId = await repository.completeImportJob({
    result: { count, errors: dbErrors, warning, numeroBioValid, numeroBioError },
    jobId
  })

  for (const { numeroBio, message, code } of dbErrors) {
    await repository.insertImportLog(importId, {
      numeroBio,
      type: importLogTypeEnumSchema.enum.error,
      code,
      message
    })
  }

  for (const [numeroBio, ws] of warning) {
    for (const w of ws) {
      await repository.insertImportLog(importId, {
        numeroBio,
        type: importLogTypeEnumSchema.enum.warning,
        code: w.code,
        message: w.message
      })
    }
  }

  return { count, errors: dbErrors, warning, numeroBioValid, numeroBioError }
}

export async function createImportJob(organismeCertificateurId: number): Promise<number> {
  return repository.insertImportJob(organismeCertificateurId)
}

export async function addErrorJob(jobId: number, error: ErrorItem): Promise<void> {
  await repository.insertImportLog(jobId, {
    numeroBio: error.numeroBio,
    idParcelle: error.idParcelle ?? null,
    nomParcelle: error.nomParcelle ?? null,
    type: importLogTypeEnumSchema.enum.error,
    code: error.code,
    message: error.message
  })
}

export async function updateJobError(
  numeroBioValid: Array<string | number>,
  numeroBioError: Array<{ numeroBio?: string | number }>,
  count: number,
  warning: Array<object> | null,
  jobId: string | number
): Promise<string | number> {
  return repository.completeImportJob({
    result: {
      count,
      errors: numeroBioError,
      warning,
      numeroBioValid,
      numeroBioError: [...new Set(numeroBioError.map((e) => e.numeroBio))]
    },
    jobId,
    statutJob: importJobResultEnumSchema.enum.REJECTED
  })
}

export async function getCurrentStatusJobs(
  id: number | string,
  organismeCertificateur: number
): Promise<ImportJobStatusResult> {
  const job = await repository.findImportJob(id, organismeCertificateur)

  if (!job) {
    return { status: 'error', error: "Aucun job n'a cet id" }
  }

  if (job.status === importStatusEnumSchema.enum.PENDING || job.status === importStatusEnumSchema.enum.CREATED) {
    return { status: job.status, created: toIsoDateTime(job.created_at) }
  }

  if (job.status === importStatusEnumSchema.enum.DONE) {
    return {
      status: job.status,
      numeroBio: job.numerobio,
      numeroClient: job.numeroclient,
      auditDate: job.audit_date,
      result: job.result_job,
      ended: job.ended_at ? toIsoDateTime(job.ended_at) : null
    }
  }

  if (job.status === importStatusEnumSchema.enum.ERROR) {
    return {
      status: job.status,
      error: job.result_job,
      ended: job.ended_at ? toIsoDateTime(job.ended_at) : null
    }
  }
  return { status: 'error', error: `Statut inconnu : ${job.status}` }
}

export async function updateImportJobStatus(
  jobId: number,
  status: ImportStatus,
  result?: Record<string, unknown>
): Promise<void> {
  await repository.updateImportJobStatusResult(jobId, status, result)
}

export async function failImportJob(jobId: number, error: unknown): Promise<void> {
  await repository.updateImportJobError(jobId, {
    name: error instanceof Error ? error.name : String(error),
    message: error instanceof Error ? error.message : String(error)
  })
}

/**
 * Exécute la phase d'insert d'un job : reçoit le validItem déjà validé,
 * fait uniquement l'insert en base et collecte les warnings post-insert.
 * Appelé en fire-and-forget après la réponse au client.
 */
export async function processFullJob(jobId: number, validItem: ValidItem): Promise<void> {
  await updateImportJobStatus(jobId, importStatusEnumSchema.enum.PENDING)
  try {
    const result = await parcellaireValidItemToDb(validItem, jobId)
    await repository.updateImportJobResult(
      jobId,
      result.errors.length > 0 ? importJobResultEnumSchema.enum.REJECTED : importJobResultEnumSchema.enum.VALID
    )
  } catch (error) {
    logger.error({ err: error }, `Traitement du job d'import ${jobId} en échec`)
    await failImportJob(jobId, error)
  }
}

export async function getImportList({
  status,
  organismeCertificateur,
  from,
  to,
  payload,
  withRejected,
  page,
  limit
}: ImportListFilters): Promise<{
  data: ImportSummary[]
  meta: { total: number; page: number; limit: number }
}> {
  const { rows, total } = await repository.findImportList({
    status,
    organismeCertificateur,
    from,
    to,
    payload,
    withRejected,
    page,
    limit
  })

  return {
    data: rows.map(normalizeJobReturn),
    meta: {
      total,
      page,
      limit
    }
  }
}

export async function getImportById({
  id,
  payload,
  organismeCertificateur
}: {
  id: string | number
  payload: boolean
  organismeCertificateur: number
}): Promise<ImportSummary | null> {
  const row = await repository.findImportById(id, organismeCertificateur, payload)
  return row ? normalizeJobReturn(row) : null
}

export async function updateStatus(
  jobId: number,
  record: Pick<InputApiRecordBody, 'numeroBio' | 'numeroClient' | 'dateAudit'>
): Promise<void> {
  const numeroBio = record?.numeroBio != null ? String(record.numeroBio) : null
  const numeroClient = record?.numeroClient != null ? String(record.numeroClient) : null
  const auditDate =
    record?.dateAudit && !Number.isNaN(Date.parse(record.dateAudit))
      ? new Date(record.dateAudit).toISOString().slice(0, 10)
      : null

  await repository.updateImportJobEtat(jobId, { numeroBio, numeroClient, auditDate })
}
