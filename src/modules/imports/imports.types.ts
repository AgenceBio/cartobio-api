import type { ImportSummary } from '@agencebio/cartobio-types'
import type { ImportStatus } from '../../database/validations/imports.js'

export type ImportJobRow = {
  status: ImportStatus
  numerobio: string | null
  numeroclient: string | null
  audit_date: string | null
  result_job: unknown
  ended_at: Date | null
  created_at: Date
}

export type ImportJobListRow = {
  jobid: number
  status: ImportSummary['status']
  created_at: Date
  started_at?: Date | null
  ended_at: Date | null
  numerobio: string | null
  numeroclient: string | null
  audit_date: string | null
  result_job: unknown
  payload: { id: string; payload: unknown } | null
}

export type ImportJobRecordInfos = {
  numeroBio: string | null
  numeroClient: string | null
  auditDate: string | null
}

export type ImportListFilters = {
  status?: string
  organismeCertificateur?: number
  from?: string
  to?: string
  payload: boolean
  withRejected: boolean
  page: number
  limit: number
}

export type OperatorRecordFilters = {
  anneeAudit?: string | number | null
  statut?: string | null
  anneeReferenceControle?: string | null
  limit?: number | null
  start?: number | null
}
