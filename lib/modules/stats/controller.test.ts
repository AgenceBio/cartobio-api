
import * as repo from './repository'
import {
  getGeneralKpi,
  getHistoriqueImports,
  getHistoriqueSpecificParcellaire,
  getRepetErreurs,
  getTableauBilan,
  getTableauErreurs,
  getTopAnomalies,
  getTopAnomaliesGrouped
} from './controller'

import { describe, expect, it, beforeEach, jest } from '@jest/globals'


jest.mock('./repository', () => ({
  getGeneralKpi: jest.fn(),
  getTableauBilanRepo: jest.fn(),
  getHistoriqueImportsRepo: jest.fn(),
  getTableauErreursRepo: jest.fn(),
  getHistoriqueSpecificParcellaireRepo: jest.fn(),
  getTopAnomaliesRepo: jest.fn(),
  getTopAnomaliesGroupedRepo: jest.fn(),
  getEnvoisSuspectsRepo: jest.fn()
}))

const mockedRepo = jest.mocked(repo)

function makeReply () {
  return { send: jest.fn() }
}

describe('dashboard controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('normalise les filtres et la pagination du tableau', async () => {
    const data = { data: [], meta: { total: 0, page: 2, limit: 50 } }
    mockedRepo.getTableauBilanRepo.mockResolvedValue(data)
    const reply = makeReply()

    await getTableauBilan({
      query: {
        from: '2026-01-01',
        to: '2026-01-31',
        page: '2',
        limit: '50',
        recherche: 'bio-42',
        statuts: 'VALID,REJECTED,',
        etats: 'DONE,ERROR'
      }
    } as any, reply as any)

    expect(mockedRepo.getTableauBilanRepo).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-01-31',
      page: 2,
      limit: 50,
      recherche: 'bio-42',
      statuts: ['VALID', 'REJECTED'],
      etats: ['DONE', 'ERROR']
    })
    expect(reply.send).toHaveBeenCalledWith(data)
  })

  it('applique les valeurs de pagination par défaut', async () => {
    mockedRepo.getTableauBilanRepo.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } })
    const reply = makeReply()

    await getTableauBilan({ query: {} } as any, reply as any)

    expect(mockedRepo.getTableauBilanRepo).toHaveBeenCalledWith({
      from: undefined,
      to: undefined,
      page: 1,
      limit: 20,
      recherche: undefined,
      statuts: undefined,
      etats: undefined
    })
  })

  it('enveloppe les KPI dans data', async () => {
    const kpi = { totalEnvoyes: 10, totalValides: 8, totalRejetes: 2, anomaliePlusFrequente: null }
    mockedRepo.getGeneralKpi.mockResolvedValue(kpi)
    const reply = makeReply()

    await getGeneralKpi({ query: { from: '2026-01-01', to: '2026-01-31' } } as any, reply as any)

    expect(mockedRepo.getGeneralKpi).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31' })
    expect(reply.send).toHaveBeenCalledWith({ data: kpi })
  })

  it('enveloppe l’historique des imports dans data', async () => {
    const data = { data: [], meta: { total: 0, page: 3, limit: 5 } }
    mockedRepo.getHistoriqueImportsRepo.mockResolvedValue(data)
    const reply = makeReply()

    await getHistoriqueImports({ query: { page: '3', limit: '5' } } as any, reply as any)

    expect(mockedRepo.getHistoriqueImportsRepo).toHaveBeenCalledWith({
      from: undefined, to: undefined, page: 3, limit: 5
    })
    expect(reply.send).toHaveBeenCalledWith({ data })
  })

  it('transmet les filtres du tableau des erreurs', async () => {
    const data = { data: [], meta: { total: 0, page: 1, limit: 20 } }
    mockedRepo.getTableauErreursRepo.mockResolvedValue(data)
    const reply = makeReply()

    await getTableauErreurs({ query: { from: '2026-02-01', recherche: 'ABC' } } as any, reply as any)

    expect(mockedRepo.getTableauErreursRepo).toHaveBeenCalledWith({
      from: '2026-02-01', to: undefined, page: 1, limit: 20, recherche: 'ABC'
    })
    expect(reply.send).toHaveBeenCalledWith(data)
  })

  it('transmet les critères de l’historique parcellaire', async () => {
    mockedRepo.getHistoriqueSpecificParcellaireRepo.mockResolvedValue([])
    const reply = makeReply()

    await getHistoriqueSpecificParcellaire({
      query: { numeroBio: 'BIO-1', numeroClient: 'CLIENT-1', auditDate: '2026-03-01' }
    } as any, reply as any)

    expect(mockedRepo.getHistoriqueSpecificParcellaireRepo).toHaveBeenCalledWith({
      numeroBio: 'BIO-1', numeroClient: 'CLIENT-1', auditDate: '2026-03-01'
    })
    expect(reply.send).toHaveBeenCalledWith([])
  })

  it('enveloppe les top anomalies simples dans data', async () => {
    const data = [{ period: '2026-01-01', code: 'E1', count: 2 }]
    mockedRepo.getTopAnomaliesRepo.mockResolvedValue(data)
    const reply = makeReply()

    await getTopAnomalies({ query: { from: '2026-01-01', to: '2026-01-07' } } as any, reply as any)

    expect(mockedRepo.getTopAnomaliesRepo).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-07' })
    expect(reply.send).toHaveBeenCalledWith({ data })
  })

  it('renvoie directement les anomalies groupées et les répétitions', async () => {
    mockedRepo.getTopAnomaliesGroupedRepo.mockResolvedValue([])
    mockedRepo.getEnvoisSuspectsRepo.mockResolvedValue([])
    const groupedReply = makeReply()
    const suspectsReply = makeReply()

    await getTopAnomaliesGrouped({ query: { from: '2026-01-01', to: '2026-01-07' } } as any, groupedReply as any)
    await getRepetErreurs({ query: { from: '2026-01-01', to: '2026-01-07' } } as any, suspectsReply as any)

    expect(groupedReply.send).toHaveBeenCalledWith([])
    expect(suspectsReply.send).toHaveBeenCalledWith([])
  })
})
