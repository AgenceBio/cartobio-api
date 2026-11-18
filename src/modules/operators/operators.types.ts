import type { AgenceBioNormalizedOperatorWithRecord } from '@agencebio/cartobio-types'
import type { CertificationEtat } from '../../database/validations/parcellaires.js'

export type NumeroBio = string | number

export type OperatorRecordRow = {
  certification_state: CertificationEtat
  audit_date: string | null
  certification_date_debut: string | null
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

export type OperatorRecordData = Omit<OperatorRecordRow, 'created_at' | 'updated_at'> & {
  created_at: string
  updated_at: string
  lastcertifieddate: number | null
  lastmixitestate: string | null
}

export type OperatorWithRecordData = AgenceBioNormalizedOperatorWithRecord & Partial<Omit<OperatorRecordData, 'metadata'>> & {
  otherParcellaire?: OperatorRecordData[] | null
}

export type OperatorRecordWithUser<T> = Omit<T, 'user_id' | 'user_role'> & {
  user: string | null
}

export type ImportPacRow = {
  size: string | null
  nb_parcelles: string | null
  pacage: string | null
  imported: boolean
  record: unknown
}

export type DashboardStateRow = {
  certifie: boolean
  numerobios: string[]
}
