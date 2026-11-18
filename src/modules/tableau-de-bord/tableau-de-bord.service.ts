import * as repository from './tableau-de-bord.repository.js'
import type { StatsQuery } from '@agencebio/cartobio-types'

async function getGeneralKpi ({ from, to }: StatsQuery, organismeCertificateur?: number) {
  return repository.getGeneralKpi({ from, to, organismeCertificateur })
}

async function getTableauBilan ({ from, to, page = '1', limit = '20', recherche, statuts, etats, ordreDate }: StatsQuery, organismeCertificateur?: number) {
  return repository.getTableauBilanRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    statuts: statuts ? statuts.split(',').filter(Boolean) : undefined,
    etats: etats ? etats.split(',').filter(Boolean) : undefined,
    ordreDate: ordreDate === 'asc' ? 'asc' : 'desc',
    organismeCertificateur
  })
}

async function getHistoriqueSpecificParcellaire ({ numeroBio, numeroClient, auditDate }: StatsQuery, organismeCertificateur?: number) {
  return repository.getHistoriqueSpecificParcellaireRepo({
    numeroBio,
    numeroClient,
    auditDate,
    organismeCertificateur
  })
}

async function getTableauErreurs ({ from, to, page = '1', limit = '20', recherche, ordreDate, codes }: StatsQuery, organismeCertificateur?: number) {
  const ordreDateValue = ordreDate === 'asc' || ordreDate === 'desc' ? ordreDate : undefined
  const codesValue = (
    Array.isArray(codes) ? codes : typeof codes === 'string' ? codes.split(',') : []
  )
    .map((code) => String(code).trim())
    .filter(Boolean)

  return repository.getTableauErreursRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    ordreDate: ordreDateValue,
    codes: codesValue.length ? codesValue : undefined,
    organismeCertificateur
  })
}

async function getTopAnomalies ({ from, to }: StatsQuery, organismeCertificateur?: number) {
  return repository.getTopAnomaliesRepo({ from, to, organismeCertificateur })
}

async function getTopAnomaliesGrouped ({ from, to }: StatsQuery, organismeCertificateur?: number) {
  return repository.getTopAnomaliesGroupedRepo({ from, to, organismeCertificateur })
}

async function getRepetErreurs ({ from, to, page = '1', limit = '10', recherche, type }: StatsQuery, organismeCertificateur?: number) {
  const typeValue = type === 'envois' || type === 'refus' ? type : undefined

  return repository.getEnvoisSuspectsRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    type: typeValue,
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
