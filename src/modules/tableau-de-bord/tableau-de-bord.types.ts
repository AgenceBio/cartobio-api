import type { ImportJobEtat, ImportJobResult } from '../../database/validations/imports.js'

type OrdreTri = 'asc' | 'desc'

export type Numeric = string | number | null

export type StatutJob = ImportJobResult

export type EtatJob = ImportJobEtat

type TypeStreak = 'envois' | 'refus'

export type DateRange = {
  from?: string
  to?: string
  organismeCertificateur?: number
}

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
  organismeCertificateur?: number
}

export type ErrorDetail = {
  numeroBio: string | null
  parcelleId: string | null
  parcelleName: string | null
  code: string | null
  message: string | null
}

type ErrorByCode = {
  code: string | null
  count: number | null
}

export type PeriodeAnomalies = {
  period: Date
  accepted: number | null
  refused: number | null
  errorCount: number
  errors: ErrorByCode[]
}

type EnvoiSuspect = {
  jobId: number
  statut: string | null
  etat: string
  createdAt: Date
  erreurs: ErrorDetail[]
}

export type GroupeEnvois = {
  numeroBio: string | null
  numeroClient: string | null
  auditDate: string | null
  envois: EnvoiSuspect[]
}

export type AlerteSuspecte = GroupeEnvois & {
  type: TypeStreak
}

export type StreakSuspecte<T> = {
  type: TypeStreak
  envois: T[]
}
