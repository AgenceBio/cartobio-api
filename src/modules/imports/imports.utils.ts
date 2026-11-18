import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  organismeCertificateur,
  parcellaireImportPayload,
  parcellaires,
  parcellaireImport
} from '../../database/schema/index.js'
import { recordColumns } from '../../shared/parcellaires/parcellaires.utils.js'
import type { ImportJobListRow, OperatorRecordFilters } from './imports.types.js'

export const importJobColumns = {
  jobid: parcellaireImport.id,
  status: parcellaireImport.status,
  created_at: parcellaireImport.createdAt,
  ended_at: parcellaireImport.endedAt,
  numerobio: parcellaireImport.numeroBio,
  numeroclient: parcellaireImport.numeroClient,
  audit_date: parcellaireImport.auditDate,
  result_job: parcellaireImport.resultJob
}

export function payloadColumn(includePayload: boolean): SQL<ImportJobListRow['payload']> {
  return includePayload
    ? sql`json_build_object('id', ${parcellaireImportPayload.id}, 'payload', ${parcellaireImportPayload.payload})`
    : sql`NULL`
}

export const operatorRecordColumns = {
  ...recordColumns,
  oc_label: organismeCertificateur.label
}

export function operatorRecordConditions({ anneeAudit, statut, anneeReferenceControle }: OperatorRecordFilters): SQL[] {
  const conditions: SQL[] = []

  if (anneeAudit) {
    conditions.push(sql`EXTRACT(YEAR FROM ${parcellaires.auditDate}) = ${Number(anneeAudit)}`)
  }

  if (statut) {
    conditions.push(sql`${parcellaires.certificationEtat}::text = ${statut}`)
  }

  if (anneeReferenceControle) {
    conditions.push(eq(parcellaires.anneeReferenceControle, Number(anneeReferenceControle)))
  }

  return conditions
}
