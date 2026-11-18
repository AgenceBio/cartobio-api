import * as repository from './tableau-de-bord.repository.js'
import { getStreaksSuspectes } from './tableau-de-bord.utils.js'
import type { AlerteSuspecte, GroupeEnvois, PeriodeAnomalies } from './tableau-de-bord.types.js'
import { toIsoDateTime } from '@agencebio/cartobio-types'
import type {
  GeneralKpiResponse,
  HistoriqueResponse,
  RepetitionsResponse,
  StatsQuery,
  TableauBilanResponse,
  TableauErreursResponse,
  TopAnomaliesGroupedResponse,
  TopAnomaliesResponse
} from '@agencebio/cartobio-types'

export async function getGeneralKpi(
  { from, to }: StatsQuery,
  organismeCertificateur: number
): Promise<GeneralKpiResponse['data']> {
  return repository.findGeneralKpi({ from, to, organismeCertificateur })
}

export async function getTableauBilan(
  { from, to, page = 1, limit = 20, recherche, statuts, etats, ordreDate }: StatsQuery,
  organismeCertificateur: number
): Promise<TableauBilanResponse> {
  return repository.findTableauBilan({
    from,
    to,
    page,
    limit,
    recherche,
    statuts,
    etats,
    ordreDate: ordreDate ?? 'desc',
    organismeCertificateur
  })
}

export async function getHistoriqueSpecificParcellaire(
  { numeroBio, numeroClient, auditDate }: StatsQuery,
  organismeCertificateur: number
): Promise<HistoriqueResponse> {
  return repository.findHistoriqueParcellaire({
    numeroBio,
    numeroClient,
    auditDate,
    organismeCertificateur
  })
}

export async function getTableauErreurs(
  { from, to, page = 1, limit = 20, recherche, ordreDate, codes }: StatsQuery,
  organismeCertificateur: number
): Promise<TableauErreursResponse> {
  const codesValue = (codes ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)

  return repository.findTableauErreurs({
    from,
    to,
    page,
    limit,
    recherche,
    ordreDate,
    codes: codesValue.length ? codesValue : undefined,
    organismeCertificateur
  })
}

export async function getTopAnomalies(
  { from, to }: Required<Pick<StatsQuery, 'from' | 'to'>>,
  organismeCertificateur: number
): Promise<TopAnomaliesResponse['data']> {
  return repository.findTopAnomalies({ from, to, organismeCertificateur })
}

export async function getTopAnomaliesGrouped(
  { from, to }: Required<Pick<StatsQuery, 'from' | 'to'>>,
  organismeCertificateur: number
): Promise<TopAnomaliesGroupedResponse> {
  const rows = await repository.findTopAnomaliesGrouped({ from, to, organismeCertificateur })

  const periods = new Map<string, PeriodeAnomalies>()

  for (const row of rows) {
    const key = toIsoDateTime(new Date(row.period))

    let currentPeriod = periods.get(key)

    if (!currentPeriod) {
      currentPeriod = {
        period: key,
        accepted: row.accepted,
        refused: row.refused,
        errorCount: 0,
        errors: []
      }
      periods.set(key, currentPeriod)
    }

    if (row.code) {
      currentPeriod.errors.push({
        code: row.code,
        count: row.errorCount
      })

      currentPeriod.errorCount += row.errorCount
    }
  }

  return Array.from(periods.values())
}

export async function getRepetErreurs(
  { from, to, page = 1, limit = 10, recherche, type }: StatsQuery & Required<Pick<StatsQuery, 'from' | 'to'>>,
  organismeCertificateur: number
): Promise<RepetitionsResponse> {
  const rows = await repository.findEnvois({ from, to, recherche, organismeCertificateur })

  const groupes = new Map<string, GroupeEnvois>()

  for (const row of rows) {
    const key = `${row.numeroBio}|${row.numeroClient}|${row.auditDate}`

    let groupe = groupes.get(key)

    if (!groupe) {
      groupe = {
        numeroBio: row.numeroBio,
        numeroClient: row.numeroClient,
        auditDate: row.auditDate,
        envois: []
      }
      groupes.set(key, groupe)
    }

    groupe.envois.push({
      jobId: row.jobId,
      statut: row.statut,
      etat: row.etat,
      createdAt: row.createdAt,
      erreurs: row.erreurs
    })
  }

  const alertes: AlerteSuspecte[] = []

  for (const groupe of groupes.values()) {
    for (const streak of getStreaksSuspectes(groupe.envois)) {
      alertes.push({
        numeroBio: groupe.numeroBio,
        numeroClient: groupe.numeroClient,
        auditDate: groupe.auditDate,
        type: streak.type,
        envois: streak.envois
      })
    }
  }

  const alertesFiltrees = type ? alertes.filter((alerte) => alerte.type === type) : alertes

  const offset = (page - 1) * limit

  return {
    data: alertesFiltrees.slice(offset, offset + limit),
    meta: {
      total: alertesFiltrees.length,
      page,
      limit
    }
  }
}
