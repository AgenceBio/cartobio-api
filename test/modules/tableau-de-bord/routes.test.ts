import { toIsoDateTime } from '@agencebio/cartobio-types'
import request from 'supertest'
import { createSigner } from 'fast-jwt'
import app from '../../../src/app.js'
import config from '../../../src/config/env.js'
import { got } from '../../got-mock.js'
import * as service from '../../../src/modules/tableau-de-bord/tableau-de-bord.service.js'
import { getCachedUserProfile } from '../../../src/modules/auth/auth.service.js'
import type { CartoBioUser } from '@agencebio/cartobio-types'

vi.mock('../../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn()
}))

vi.mock('../../../src/modules/tableau-de-bord/tableau-de-bord.service.js', () => ({
  getGeneralKpi: vi.fn(),
  getTableauBilan: vi.fn(),
  getTableauErreurs: vi.fn(),
  getHistoriqueSpecificParcellaire: vi.fn(),
  getTopAnomalies: vi.fn(),
  getTopAnomaliesGrouped: vi.fn(),
  getRepetErreurs: vi.fn()
}))

const sign = createSigner({ key: config.get('jwtSecret') })
const fakeOc = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }
const fakeUser = {
  id: 1,
  prenom: 'Tonio',
  nom: 'Est',
  test: true,
  organismeCertificateur: fakeOc,
  mainGroup: { id: 2 }
}
const USER_AUTH_HEADER = `Bearer ${sign(fakeUser)}`
vi.mocked(getCachedUserProfile).mockResolvedValue(fakeUser as unknown as CartoBioUser)
const OC_TOKEN = 'aaaa-bbbb-cccc-dddd'

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(() => {
  got.post.mockReturnValue({
    async json() {
      return fakeOc
    }
  })
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v3/tdb-api/*', () => {
  test('refuse une requête sans jeton', async () => {
    const response = await request(app.server).get('/api/v3/tdb-api/general-kpi')

    expect(response.status).toEqual(401)
    expect(service.getGeneralKpi).not.toHaveBeenCalled()
  })

  test('enveloppe les KPI dans data, avec l’OC du jeton d’API', async () => {
    const kpi = { totalEnvoyes: 10, totalValides: 8, totalRejetes: 2, anomaliePlusFrequente: null }
    vi.mocked(service.getGeneralKpi).mockResolvedValueOnce(kpi)

    const response = await request(app.server)
      .get('/api/v3/tdb-api/general-kpi?from=2026-01-01&to=2026-01-31')
      .set('Authorization', OC_TOKEN)

    expect(response.status).toEqual(200)
    expect(response.body).toEqual({ data: kpi })
    expect(service.getGeneralKpi).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31' }, 999)
  })

  test('utilise l’OC de l’utilisateur CartoBio', async () => {
    vi.mocked(service.getTableauBilan).mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, limit: 20 } })

    const response = await request(app.server)
      .get('/api/v3/tdb-api/tableau?statuts=VALID')
      .set('Authorization', USER_AUTH_HEADER)

    expect(response.status).toEqual(200)
    expect(response.body).toEqual({ data: [], meta: { total: 0, page: 1, limit: 20 } })
    expect(service.getTableauBilan).toHaveBeenCalledWith({ statuts: ['VALID'] }, 999)
  })

  const emptyPage = { data: [], meta: { total: 0, page: 1, limit: 20 } }

  test.each([
    [
      '/tableau-errors',
      service.getTableauErreurs,
      () => vi.mocked(service.getTableauErreurs).mockResolvedValueOnce(emptyPage),
      emptyPage,
      {}
    ],
    [
      '/historique',
      service.getHistoriqueSpecificParcellaire,
      () => vi.mocked(service.getHistoriqueSpecificParcellaire).mockResolvedValueOnce([]),
      [],
      { numeroBio: '123' }
    ],
    [
      '/top-anomalies-grouped',
      service.getTopAnomaliesGrouped,
      () => vi.mocked(service.getTopAnomaliesGrouped).mockResolvedValueOnce([]),
      [],
      { from: '2026-01-01', to: '2026-01-31' }
    ],
    [
      '/repet-ano',
      service.getRepetErreurs,
      () => vi.mocked(service.getRepetErreurs).mockResolvedValueOnce(emptyPage),
      emptyPage,
      { from: '2026-01-01', to: '2026-01-31' }
    ]
  ])('%s renvoie directement le résultat du service', async (path, fn, mockResult, expected, query) => {
    mockResult()

    const response = await request(app.server).get(`/api/v3/tdb-api${path}`).query(query).set('Authorization', OC_TOKEN)

    expect(response.status).toEqual(200)
    expect(response.body).toEqual(expected)
    expect(fn).toHaveBeenCalledWith(query, 999)
  })

  test('enveloppe les top anomalies simples dans data', async () => {
    const data = [{ period: toIsoDateTime(new Date('2026-01-01')), code: 'E1', count: 2 }]
    vi.mocked(service.getTopAnomalies).mockResolvedValueOnce(data)

    const response = await request(app.server)
      .get('/api/v3/tdb-api/top-anomalies?from=2026-01-01&to=2026-01-07')
      .set('Authorization', OC_TOKEN)

    expect(response.status).toEqual(200)
    expect(response.body).toEqual({ data: [{ period: '2026-01-01T00:00:00.000Z', code: 'E1', count: 2 }] })
  })
})
