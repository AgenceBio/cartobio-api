import type { ImportErrorDetail, IsoDate, IsoDateTime } from '@agencebio/cartobio-types'
import type { ImportJobEtat, ImportJobResult } from '../../database/validations/imports.js'

type OrdreTri = 'asc' | 'desc'

export type Numeric = string | number | null

export type StatutJob = ImportJobResult

export type EtatJob = ImportJobEtat

type TypeStreak = 'envois' | 'refus'

export type DateRange = {
  from?: string
  to?: string
  organismeCertificateur: number
}

export type PeriodeObligatoire = Required<DateRange>

export type PaginationParams = DateRange & {
  page: number
  limit: number
  recherche?: string
  statuts?: StatutJob[]
  etats?: EtatJob[]
  ordreDate?: OrdreTri
  codes?: string[]
  type?: TypeStreak
}

export type HistoriqueParams = {
  numeroBio?: string
  numeroClient?: string
  auditDate?: string
  organismeCertificateur: number
}

export type ErrorDetail = ImportErrorDetail

type ErrorByCode = {
  code: string
  count: number
}

export type PeriodeAnomalies = {
  period: IsoDateTime
  accepted: number
  refused: number
  errorCount: number
  errors: ErrorByCode[]
}

type EnvoiSuspect = {
  jobId: number
  statut: StatutJob | null
  etat: EtatJob
  createdAt: IsoDateTime
  erreurs: ErrorDetail[]
}

export type GroupeEnvois = {
  numeroBio: string | null
  numeroClient: string | null
  auditDate: IsoDate | null
  envois: EnvoiSuspect[]
}

export type EnvoiParcellaire = EnvoiSuspect & Omit<GroupeEnvois, 'envois'>

export type AnomaliesPeriodeRow = {
  period: Date
  accepted: number
  refused: number
  code: string | null
  errorCount: number
}

export type AlerteSuspecte = GroupeEnvois & {
  type: TypeStreak
}

export type StreakSuspecte<T> = {
  type: TypeStreak
  envois: T[]
}
