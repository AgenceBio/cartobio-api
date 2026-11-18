import type {
  ImportJobStatusResponse,
  ImportLogCode,
  ImportSummary,
  InputApiRecordBody,
  IsoDate,
  RecordInfos
} from '@agencebio/cartobio-types'
import type { ImportStatus } from '../../database/validations/imports.js'
import type { CertificationEtat } from '../../database/validations/parcellaires.js'
import type { RecordInput } from '../../shared/parcellaires/parcellaires.types.js'

export type ImportWarning = { numeroBio: string; message: string; code: ImportLogCode }

export type ImportJobStatusResult = ImportJobStatusResponse | { status: 'error'; error: string }

export type ValidItem = {
  record: RecordInput & Pick<RecordInfos, 'numerobio'>
  numeroBio: string
  warnings: ImportWarning[]
}

export type RecordError = { message: string; code: ImportLogCode }

export type FeatureError = RecordError & {
  idParcelle?: string | number | null
  nomParcelle?: string | null
}

export type ErrorItem = FeatureError & { numeroBio?: string }

export type ParsedRecord =
  | (ValidItem & { json: InputApiRecordBody; errors?: undefined })
  | {
      numeroBio: string
      errors: FeatureError[]
      json: InputApiRecordBody
      record?: undefined
      warnings?: undefined
    }

export type ImportJobRow = {
  status: ImportStatus
  numerobio: string | null
  numeroclient: string | null
  audit_date: IsoDate | null
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
  audit_date: IsoDate | null
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
  statut?: CertificationEtat | null
  anneeReferenceControle?: string | null
  limit?: number | null
  start?: number | null
}
