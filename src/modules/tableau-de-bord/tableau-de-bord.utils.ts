export type OrdreTri = 'asc' | 'desc'

export type DateRange = {
  from?: string
  to?: string
  organismeCertificateur?: number
}

export type PaginationParams = DateRange & {
  page: number
  limit: number
  recherche?: string
  statuts?: string[]
  etats?: string[]
  ordreDate?: OrdreTri
  codes?: string[]
  type?: string
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

export type ErrorByCode = {
  code: string | null
  count: number | null
}

function getTypeEnvoi (statut: string | null): 'success' | 'echec' | null {
  if (statut === 'VALID') {
    return 'success'
  }

  if (statut === 'REJECTED' || statut === 'ERROR') {
    return 'echec'
  }

  return null
}

const NB_MINIMUM_STREAK = 4

function getStreaksSuspectes<T extends { statut: string | null }> (envois: T[]): Array<{ type: 'envois' | 'refus'; envois: T[] }> {
  const streaks: Array<{ type: 'envois' | 'refus'; envois: T[] }> = []
  let streakStart = 0

  for (let i = 1; i <= envois.length; i++) {
    const typeDebut = getTypeEnvoi(envois[streakStart].statut)

    const sameType =
      i < envois.length && getTypeEnvoi(envois[i].statut) === typeDebut && typeDebut !== null

    if (!sameType) {
      const streakLength = i - streakStart

      if (streakLength >= NB_MINIMUM_STREAK && typeDebut !== null) {
        streaks.push({
          type: typeDebut === 'success' ? 'envois' : 'refus',
          envois: envois.slice(streakStart, i)
        })
      }

      streakStart = i
    }
  }

  return streaks
}

export { getStreaksSuspectes }
