import request from 'supertest'
import { createSigner } from 'fast-jwt'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../../../src/app.js'
import config from '../../../src/config/env.js'
import { getCachedUserProfile } from '../../../src/modules/auth/auth.service.js'
import * as service from '../../../src/modules/operators/operators.service.js'
import { got } from '../../got-mock.js'
import agencebioOperator from '../../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

vi.mock('../../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn()
}))
vi.mock('../../../src/modules/operators/operators.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  searchControlBodyRecords: vi.fn(),
  searchControlBodyRecordsAdmin: vi.fn(),
  searchForAutocomplete: vi.fn(),
  listUserOperators: vi.fn(),
  getOperatorsDashboard: vi.fn(),
  getDashboardSummary: vi.fn(),
  getPinnedOperators: vi.fn(),
  pinOperator: vi.fn(),
  unpinOperator: vi.fn(),
  consultOperator: vi.fn(),
  getOperatorRecordsForUser: vi.fn(),
  getImportPAC: vi.fn(),
  hideImport: vi.fn()
}))

const sign = createSigner({ key: config.get('jwtSecret') })
const ocUser = {
  id: 1,
  prenom: 'Tonio',
  nom: 'Est',
  organismeCertificateur: { id: 999, nom: 'CartobiOC' },
  groups: [{ id: '8', nom: 'Auditeur' }],
  mainGroup: { id: '8', nom: 'Auditeur' }
}
const operatorUser = {
  id: 2,
  prenom: 'Opé',
  nom: 'Rateur',
  groups: [{ id: '4', nom: 'Opérateur' }],
  mainGroup: { id: '4', nom: 'Opérateur' }
}
const adminUser = {
  id: 3,
  prenom: 'Ad',
  nom: 'Min',
  groups: [{ id: '1', nom: 'Admin' }],
  mainGroup: { id: '1', nom: 'Admin' }
}
const users: Record<number, object> = { 1: ocUser, 2: operatorUser, 3: adminUser }
const OC = `Bearer ${sign(ocUser)}`
const OPERATOR = `Bearer ${sign(operatorUser)}`
const ADMIN = `Bearer ${sign(adminUser)}`
const pagination = { page: 1, total: 0, page_max: 1 }

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(() => {
  vi.mocked(getCachedUserProfile).mockImplementation(async (id) => users[id] as CartoBioUser)
  got.get.mockReturnValue({
    async json() {
      return agencebioOperator
    }
  })
})
afterEach(() => {
  vi.clearAllMocks()
  got.get.mockReset()
})

describe('POST /api/v2/certification/search', () => {
  test("recherche parmi les opérateurs de l'OC de l'utilisateur", async () => {
    vi.mocked(service.searchControlBodyRecords).mockResolvedValue({ pagination, records: [] })

    const response = await request(app.server)
      .post('/api/v2/certification/search')
      .set('Authorization', OC)
      .send({ input: 'ferme', filter: { pinned: true } })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ pagination, records: [] })
    expect(service.searchControlBodyRecords).toHaveBeenCalledWith({
      ocId: 999,
      userId: 1,
      input: 'ferme',
      page: 1,
      limit: 7,
      filter: expect.objectContaining({ pinned: true })
    })
  })

  test('est réservée aux organismes certificateurs', async () => {
    const response = await request(app.server)
      .post('/api/v2/certification/search')
      .set('Authorization', OPERATOR)
      .send({ input: '' })

    expect(response.status).toBe(403)
    expect(service.searchControlBodyRecords).not.toHaveBeenCalled()
  })

  test('refuse une limite trop grande', async () => {
    const response = await request(app.server)
      .post('/api/v2/certification/search')
      .set('Authorization', OC)
      .send({ input: '', limit: 101 })

    expect(response.status).toBe(400)
  })
})

describe('POST /api/v2/certification/adminsearch', () => {
  test("est réservée à l'administrateur", async () => {
    const response = await request(app.server)
      .post('/api/v2/certification/adminsearch')
      .set('Authorization', OC)
      .send({ input: 'x' })

    expect(response.status).toBe(403)
    expect(service.searchControlBodyRecordsAdmin).not.toHaveBeenCalled()
  })

  test("recherche tous les opérateurs pour l'administrateur", async () => {
    vi.mocked(service.searchControlBodyRecordsAdmin).mockResolvedValue({ pagination, records: [] })

    const response = await request(app.server)
      .post('/api/v2/certification/adminsearch')
      .set('Authorization', ADMIN)
      .send({ input: 'x', page: 2 })

    expect(response.status).toBe(200)
    expect(service.searchControlBodyRecordsAdmin).toHaveBeenCalledWith({
      input: 'x',
      page: 2,
      limit: 7,
      filter: undefined
    })
  })
})

describe('GET /api/v2/certification/autocomplete', () => {
  test("cherche parmi les clients de l'OC", async () => {
    vi.mocked(service.searchForAutocomplete).mockResolvedValue([])

    await request(app.server).get('/api/v2/certification/autocomplete?search=fer').set('Authorization', OC)

    expect(service.searchForAutocomplete).toHaveBeenCalledWith(999, 1, 'fer')
  })

  test("cherche parmi les opérateurs de l'utilisateur sans OC", async () => {
    vi.mocked(service.searchForAutocomplete).mockResolvedValue([])

    await request(app.server).get('/api/v2/certification/autocomplete').set('Authorization', OPERATOR)

    expect(service.searchForAutocomplete).toHaveBeenCalledWith(undefined, 2, undefined)
  })
})

describe('GET /api/v2/operators', () => {
  test('applique la pagination par défaut', async () => {
    vi.mocked(service.listUserOperators).mockResolvedValue({ nbTotal: 0, operators: [] })

    const response = await request(app.server).get('/api/v2/operators').set('Authorization', OPERATOR)

    expect(response.status).toBe(200)
    expect(service.listUserOperators).toHaveBeenCalledWith(2, { search: undefined, limit: 100, offset: 0 })
  })

  test('convertit les paramètres de pagination', async () => {
    vi.mocked(service.listUserOperators).mockResolvedValue({ nbTotal: 0, operators: [] })

    await request(app.server).get('/api/v2/operators?search=a&limit=10&offset=20').set('Authorization', OPERATOR)

    expect(service.listUserOperators).toHaveBeenCalledWith(2, { search: 'a', limit: 10, offset: 20 })
  })

  test.each(['limit=0', 'limit=1001', 'offset=-1'])('refuse %s', async (query) => {
    const response = await request(app.server).get(`/api/v2/operators?${query}`).set('Authorization', OPERATOR)

    expect(response.status).toBe(400)
  })
})

describe('tableau de bord', () => {
  test("GET /api/v2/operators/dashboard utilise l'OC de l'utilisateur", async () => {
    vi.mocked(service.getOperatorsDashboard).mockResolvedValue({ pinnedOperators: [], consultedOperators: [] })

    const response = await request(app.server).get('/api/v2/operators/dashboard').set('Authorization', OC)

    expect(response.status).toBe(200)
    expect(service.getOperatorsDashboard).toHaveBeenCalledWith(1, 999)
  })

  test('POST /api/v2/operators/dashboard-summary transmet les filtres', async () => {
    const summary = { countCertifiees: 1, countEnAttentes: 2, countNonAuditees: 3 }
    vi.mocked(service.getDashboardSummary).mockResolvedValue(summary)

    const response = await request(app.server)
      .post('/api/v2/operators/dashboard-summary')
      .set('Authorization', OC)
      .send({ departements: ['26'], anneeReferenceControle: 2025 })

    expect(response.body).toEqual(summary)
    expect(service.getDashboardSummary).toHaveBeenCalledWith(999, ['26'], 2025)
  })

  test('POST /api/v2/operators/dashboard-summary est réservé aux OC', async () => {
    const response = await request(app.server)
      .post('/api/v2/operators/dashboard-summary')
      .set('Authorization', OPERATOR)
      .send({ departements: [], anneeReferenceControle: 2025 })

    expect(response.status).toBe(403)
  })
})

describe('/api/v2/operator/:numeroBio', () => {
  test("GET indique si l'opérateur est épinglé", async () => {
    vi.mocked(service.getPinnedOperators).mockResolvedValue([99999])

    const response = await request(app.server).get('/api/v2/operator/99999').set('Authorization', OC)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ numeroBio: '99999', epingle: true })
    expect(service.getPinnedOperators).toHaveBeenCalledWith(1)
  })

  test.each([
    ['pin', 'pinOperator', 200, { epingle: true }],
    ['unpin', 'unpinOperator', 200, { epingle: false }],
    ['consulte', 'consultOperator', 204, {}]
  ] as const)('POST %s', async (action, method, status, body) => {
    const response = await request(app.server).post(`/api/v2/operator/99999/${action}`).set('Authorization', OC)

    expect(response.status).toBe(status)
    expect(response.body).toEqual(body)
    expect(service[method]).toHaveBeenCalledWith('99999', 1)
  })

  test("POST pin refuse un OC qui ne certifie pas l'opérateur", async () => {
    vi.mocked(getCachedUserProfile).mockResolvedValue({
      ...ocUser,
      organismeCertificateur: { id: 1, nom: 'Autre OC' }
    } as unknown as CartoBioUser)

    const response = await request(app.server).post('/api/v2/operator/99999/pin').set('Authorization', OC)

    expect(response.status).toBe(401)
    expect(service.pinOperator).not.toHaveBeenCalled()
  })

  test("GET records transmet l'utilisateur et l'opérateur", async () => {
    vi.mocked(service.getOperatorRecordsForUser).mockResolvedValue([])

    const response = await request(app.server).get('/api/v2/operator/99999/records').set('Authorization', OC)

    expect(response.status).toBe(200)
    expect(service.getOperatorRecordsForUser).toHaveBeenCalledWith(
      99999,
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ numeroBio: '99999' })
    )
  })

  test('GET importData enveloppe le résultat', async () => {
    vi.mocked(service.getImportPAC).mockResolvedValue(null)

    const response = await request(app.server).get('/api/v2/operator/99999/importData').set('Authorization', OC)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: null })
  })

  test('PATCH hideNotif masque la notification', async () => {
    const response = await request(app.server).patch('/api/v2/operator/99999/hideNotif').set('Authorization', OC)

    expect(response.status).toBe(204)
    expect(service.hideImport).toHaveBeenCalledWith('99999')
  })
})
