import { toIsoDateTime } from '@agencebio/cartobio-types'
import * as repository from '../../../src/modules/tableau-de-bord/tableau-de-bord.repository.js'
import {
  getGeneralKpi,
  getHistoriqueSpecificParcellaire,
  getRepetErreurs,
  getTableauBilan,
  getTableauErreurs,
  getTopAnomalies
} from '../../../src/modules/tableau-de-bord/tableau-de-bord.service.js'

vi.mock('../../../src/modules/tableau-de-bord/tableau-de-bord.repository.js', () => ({
  getGeneralKpi: vi.fn(),
  getTableauBilanRepo: vi.fn(),
  getTableauErreursRepo: vi.fn(),
  getHistoriqueSpecificParcellaireRepo: vi.fn(),
  getTopAnomaliesRepo: vi.fn(),
  getTopAnomaliesGroupedRepo: vi.fn(),
  getEnvoisSuspectsRepo: vi.fn()
}))

const mockedRepo = vi.mocked(repository)

describe('dashboard service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalise les filtres et la pagination du tableau', async () => {
    const data = { data: [], meta: { total: 0, page: 2, limit: 50 } }
    mockedRepo.getTableauBilanRepo.mockResolvedValue(data)

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

    expect(mockedRepo.getTableauBilanRepo).toHaveBeenCalledWith({
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
    mockedRepo.getTableauBilanRepo.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20 }
    })

    await getTableauBilan({}, 999)

    expect(mockedRepo.getTableauBilanRepo).toHaveBeenCalledWith({
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
    mockedRepo.getGeneralKpi.mockResolvedValue(kpi)

    const result = await getGeneralKpi({ from: '2026-01-01', to: '2026-01-31' }, 999)

    expect(mockedRepo.getGeneralKpi).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-01-31',
      organismeCertificateur: 999
    })
    expect(result).toEqual(kpi)
  })

  it('transmet les filtres du tableau des erreurs', async () => {
    const data = { data: [], meta: { total: 0, page: 1, limit: 20 } }
    mockedRepo.getTableauErreursRepo.mockResolvedValue(data)

    const result = await getTableauErreurs({ from: '2026-02-01', recherche: 'ABC' }, 999)

    expect(mockedRepo.getTableauErreursRepo).toHaveBeenCalledWith({
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
    mockedRepo.getHistoriqueSpecificParcellaireRepo.mockResolvedValue([])

    const result = await getHistoriqueSpecificParcellaire(
      {
        numeroBio: 'BIO-1',
        numeroClient: 'CLIENT-1',
        auditDate: '2026-03-01'
      },
      999
    )

    expect(mockedRepo.getHistoriqueSpecificParcellaireRepo).toHaveBeenCalledWith({
      numeroBio: 'BIO-1',
      numeroClient: 'CLIENT-1',
      auditDate: '2026-03-01',
      organismeCertificateur: 999
    })
    expect(result).toEqual([])
  })

  it('transmet la période des top anomalies', async () => {
    const data = [{ period: toIsoDateTime(new Date('2026-01-01')), code: 'E1', count: 2 }]
    mockedRepo.getTopAnomaliesRepo.mockResolvedValue(data)

    const result = await getTopAnomalies({ from: '2026-01-01', to: '2026-01-07' }, 999)

    expect(mockedRepo.getTopAnomaliesRepo).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-01-07',
      organismeCertificateur: 999
    })
    expect(result).toEqual(data)
  })

  it("exige au moins un critère pour l'historique parcellaire", async () => {
    await expect(getHistoriqueSpecificParcellaire({}, 999)).rejects.toMatchObject({ statusCode: 400 })
    expect(mockedRepo.getHistoriqueSpecificParcellaireRepo).not.toHaveBeenCalled()
  })

  it('découpe une liste de codes séparés par des virgules', async () => {
    mockedRepo.getTableauErreursRepo.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } })

    await getTableauErreurs({ codes: ' E1, ,E2 ' }, 999)

    expect(mockedRepo.getTableauErreursRepo).toHaveBeenCalledWith(expect.objectContaining({ codes: ['E1', 'E2'] }))
  })

  it("n'envoie pas de filtre de codes vide", async () => {
    mockedRepo.getTableauErreursRepo.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } })

    await getTableauErreurs({ codes: ' , ' }, 999)

    expect(mockedRepo.getTableauErreursRepo).toHaveBeenCalledWith(expect.objectContaining({ codes: undefined }))
  })

  it('exige une période pour les envois répétés', async () => {
    await expect(getRepetErreurs({ from: '2026-01-01' }, 999)).rejects.toMatchObject({
      statusCode: 400,
      message: 'La période (from et to) est obligatoire.'
    })
    expect(mockedRepo.getEnvoisSuspectsRepo).not.toHaveBeenCalled()
  })
})
