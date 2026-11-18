import type { StreakSuspecte } from './tableau-de-bord.types.js'

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

function getStreaksSuspectes<T extends { statut: string | null }> (envois: T[]): Array<StreakSuspecte<T>> {
  const streaks: Array<StreakSuspecte<T>> = []
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
