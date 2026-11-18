import type {
  AgenceBioNormalizedOperator,
  AgenceBioNormalizedOperatorWithRecord,
  IsoDate,
  IsoDateTime
} from '@agencebio/cartobio-types'
import type { CertificationEtat } from '../../database/validations/parcellaires.js'

export type NumeroBio = string | number

export type OperatorRecordRow = {
  certification_state: CertificationEtat
  audit_date: IsoDate | null
  certification_date_debut: IsoDate | null
  created_at: Date
  numerobio: string
  metadata: Record<string, unknown>
  record_id: string
  updated_at: Date
  annee_reference_controle: number
  version_name: string
  user_id: string | null
  user_role: string | null
}

type OperatorRecordData = Omit<OperatorRecordRow, 'created_at' | 'updated_at'> & {
  created_at: IsoDateTime
  updated_at: IsoDateTime
  lastcertifieddate: number | null
  lastmixitestate: string | null
}

export type OperatorWithRecordData = AgenceBioNormalizedOperatorWithRecord &
  Partial<Omit<OperatorRecordData, 'metadata'>> & {
    otherParcellaire?: OperatorRecordData[] | null
  }

export type OperatorRecordWithUser<T> = Omit<T, 'user_id' | 'user_role'> & {
  user: string | null
}

export type ImportPacRow = {
  size: number | null
  nb_parcelles: number | null
  pacage: string | null
  imported: boolean
  record: unknown
}

export type DashboardStateRow = {
  certifie: boolean
  numerobios: string[]
}

export type AgenceBioNormalizedOperatorWithFilterData = AgenceBioNormalizedOperator & {
  lastmixitestate?: string | null
  states?: Array<{
    certification_state: string
    annee_reference_controle: number
  }>
  list_oc_id?: number[]
  max_audit_date?: string | null
  metadata?: Record<string, unknown>
}
