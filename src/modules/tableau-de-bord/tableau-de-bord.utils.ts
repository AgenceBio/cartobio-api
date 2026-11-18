import { importJobResultEnumSchema } from '../../database/validations/imports.js'
import type { StreakSuspecte } from './tableau-de-bord.types.js'

function getTypeEnvoi (statut: string | null): 'success' | 'echec' | null {
  if (statut === importJobResultEnumSchema.enum.VALID) {
    return 'success'
  }

  if (statut === importJobResultEnumSchema.enum.REJECTED || statut === importJobResultEnumSchema.enum.ERROR) {
    return 'echec'
  }

  return null
}

const NB_MINIMUM_STREAK = 4

function getStreaksSuspectes<T extends { statut: string | null }> (envois: T[]): Array<StreakSuspecte<T>> {
  const streaks: Array<StreakSuspecte<T>> = []
  let streakStart = 0

  for (let i = 1; i <= envois.length; i++) {
    const debut = envois[streakStart]
    if (!debut) break
    const typeDebut = getTypeEnvoi(debut.statut)

    const suivant = envois[i]
    const sameType =
      suivant !== undefined && getTypeEnvoi(suivant.statut) === typeDebut && typeDebut !== null

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
