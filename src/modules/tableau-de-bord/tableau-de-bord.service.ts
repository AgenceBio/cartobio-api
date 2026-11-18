import * as repository from './tableau-de-bord.repository.js'
import { InvalidRequestApiError } from '../../shared/errors.js'
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

async function getGeneralKpi(
  { from, to }: StatsQuery,
  organismeCertificateur: number
): Promise<GeneralKpiResponse['data']> {
  return repository.getGeneralKpi({ from, to, organismeCertificateur })
}

async function getTableauBilan(
  { from, to, page = '1', limit = '20', recherche, statuts, etats, ordreDate }: StatsQuery,
  organismeCertificateur: number
): Promise<TableauBilanResponse> {
  return repository.getTableauBilanRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    statuts,
    etats,
    ordreDate: ordreDate ?? 'desc',
    organismeCertificateur
  })
}

async function getHistoriqueSpecificParcellaire(
  { numeroBio, numeroClient, auditDate }: StatsQuery,
  organismeCertificateur: number
): Promise<HistoriqueResponse> {
  if (!numeroBio && !numeroClient && !auditDate) {
    throw new InvalidRequestApiError('Au moins un critère est requis : numeroBio, numeroClient ou auditDate.')
  }
  return repository.getHistoriqueSpecificParcellaireRepo({
    numeroBio,
    numeroClient,
    auditDate,
    organismeCertificateur
  })
}

async function getTableauErreurs(
  { from, to, page = '1', limit = '20', recherche, ordreDate, codes }: StatsQuery,
  organismeCertificateur: number
): Promise<TableauErreursResponse> {
  const codesValue = (Array.isArray(codes) ? codes : typeof codes === 'string' ? codes.split(',') : [])
    .map((code) => String(code).trim())
    .filter(Boolean)

  return repository.getTableauErreursRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    ordreDate,
    codes: codesValue.length ? codesValue : undefined,
    organismeCertificateur
  })
}

async function getTopAnomalies(
  { from, to }: StatsQuery,
  organismeCertificateur: number
): Promise<TopAnomaliesResponse['data']> {
  return repository.getTopAnomaliesRepo({ from, to, organismeCertificateur })
}

async function getTopAnomaliesGrouped(
  { from, to }: StatsQuery,
  organismeCertificateur: number
): Promise<TopAnomaliesGroupedResponse> {
  return repository.getTopAnomaliesGroupedRepo({ from, to, organismeCertificateur })
}

async function getRepetErreurs(
  { from, to, page = '1', limit = '10', recherche, type }: StatsQuery,
  organismeCertificateur: number
): Promise<RepetitionsResponse> {
  if (!from || !to) {
    throw new InvalidRequestApiError('La période (from et to) est obligatoire.')
  }
  return repository.getEnvoisSuspectsRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    type,
    organismeCertificateur
  })
}

export {
  getGeneralKpi,
  getTableauBilan,
  getTableauErreurs,
  getHistoriqueSpecificParcellaire,
  getTopAnomalies,
  getTopAnomaliesGrouped,
  getRepetErreurs
}
