import { toIsoDateTime } from '@agencebio/cartobio-types'
import * as repository from '../../../src/modules/tableau-de-bord/tableau-de-bord.repository.js'
import {
  getGeneralKpi,
  getHistoriqueSpecificParcellaire,
  getTableauBilan,
  getTableauErreurs,
  getTopAnomalies
} from '../../../src/modules/tableau-de-bord/tableau-de-bord.service.js'

vi.mock('../../../src/modules/tableau-de-bord/tableau-de-bord.repository.js', () => ({
  findGeneralKpi: vi.fn(),
  findTableauBilan: vi.fn(),
  findTableauErreurs: vi.fn(),
  findHistoriqueParcellaire: vi.fn(),
  findTopAnomalies: vi.fn(),
  findTopAnomaliesGrouped: vi.fn(),
  findEnvois: vi.fn()
}))

const mockedRepo = vi.mocked(repository)

describe('dashboard service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalise les filtres et la pagination du tableau', async () => {
    const data = { data: [], meta: { total: 0, page: 2, limit: 50 } }
    mockedRepo.findTableauBilan.mockResolvedValue(data)

    const result = await getTableauBilan(
      {
        from: '2026-01-01',
        to: '2026-01-31',
        page: '2',
        limit: '50',
        recherche: 'bio-42',
        statuts: ['VALID', 'REJECTED'],
        etats: ['CREATED', 'UPDATED']
      },
      999
    )

    expect(mockedRepo.findTableauBilan).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-01-31',
      page: 2,
      limit: 50,
      ordreDate: 'desc',
      recherche: 'bio-42',
      statuts: ['VALID', 'REJECTED'],
      etats: ['CREATED', 'UPDATED'],
      organismeCertificateur: 999
    })
    expect(result).toEqual(data)
  })

  it('applique les valeurs de pagination par défaut', async () => {
    mockedRepo.findTableauBilan.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20 }
    })

    await getTableauBilan({}, 999)

    expect(mockedRepo.findTableauBilan).toHaveBeenCalledWith({
      from: undefined,
      to: undefined,
      page: 1,
      limit: 20,
      ordreDate: 'desc',
      recherche: undefined,
      statuts: undefined,
      etats: undefined,
      organismeCertificateur: 999
    })
  })

  it('transmet la période des KPI', async () => {
    const kpi = {
      totalEnvoyes: 10,
      totalValides: 8,
      totalRejetes: 2,
      anomaliePlusFrequente: null
    }
    mockedRepo.findGeneralKpi.mockResolvedValue(kpi)

    const result = await getGeneralKpi({ from: '2026-01-01', to: '2026-01-31' }, 999)

    expect(mockedRepo.findGeneralKpi).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-01-31',
      organismeCertificateur: 999
    })
    expect(result).toEqual(kpi)
  })

  it('transmet les filtres du tableau des erreurs', async () => {
    const data = { data: [], meta: { total: 0, page: 1, limit: 20 } }
    mockedRepo.findTableauErreurs.mockResolvedValue(data)

    const result = await getTableauErreurs({ from: '2026-02-01', recherche: 'ABC' }, 999)

    expect(mockedRepo.findTableauErreurs).toHaveBeenCalledWith({
      from: '2026-02-01',
      to: undefined,
      page: 1,
      limit: 20,
      recherche: 'ABC',
      organismeCertificateur: 999
    })
    expect(result).toEqual(data)
  })

  it('transmet les critères de l’historique parcellaire', async () => {
    mockedRepo.findHistoriqueParcellaire.mockResolvedValue([])

    const result = await getHistoriqueSpecificParcellaire(
      {
        numeroBio: 'BIO-1',
        numeroClient: 'CLIENT-1',
        auditDate: '2026-03-01'
      },
      999
    )

    expect(mockedRepo.findHistoriqueParcellaire).toHaveBeenCalledWith({
      numeroBio: 'BIO-1',
      numeroClient: 'CLIENT-1',
      auditDate: '2026-03-01',
      organismeCertificateur: 999
    })
    expect(result).toEqual([])
  })

  it('transmet la période des top anomalies', async () => {
    const data = [{ period: toIsoDateTime(new Date('2026-01-01')), code: 'E1', count: 2 }]
    mockedRepo.findTopAnomalies.mockResolvedValue(data)

    const result = await getTopAnomalies({ from: '2026-01-01', to: '2026-01-07' }, 999)

    expect(mockedRepo.findTopAnomalies).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-01-07',
      organismeCertificateur: 999
    })
    expect(result).toEqual(data)
  })

  it('découpe une liste de codes séparés par des virgules', async () => {
    mockedRepo.findTableauErreurs.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } })

    await getTableauErreurs({ codes: ' E1, ,E2 ' }, 999)

    expect(mockedRepo.findTableauErreurs).toHaveBeenCalledWith(expect.objectContaining({ codes: ['E1', 'E2'] }))
  })

  it("n'envoie pas de filtre de codes vide", async () => {
    mockedRepo.findTableauErreurs.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } })

    await getTableauErreurs({ codes: ' , ' }, 999)

    expect(mockedRepo.findTableauErreurs).toHaveBeenCalledWith(expect.objectContaining({ codes: undefined }))
  })
})
