import request from 'supertest'
import { createSigner } from 'fast-jwt'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../../../src/app.js'
import config from '../../../src/config/env.js'
import { getCachedUserProfile } from '../../../src/modules/auth/auth.service.js'
import * as service from '../../../src/modules/geometry/geometry.service.js'
import { got } from '../../got-mock.js'
import { loadRecordFixture } from '../../utils.js'
import agencebioOperator from '../../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

vi.mock('../../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn()
}))
vi.mock('../../../src/modules/geometry/geometry.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyGeometry: vi.fn(),
  getGeometryEquals: vi.fn(),
  calculateParcelBorder: vi.fn()
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
const AUTH = `Bearer ${sign(ocUser)}`
const OLD = '054f0d70-c3da-448f-823e-81fcf7c11112'
const NEW = '054f0d70-c3da-448f-823e-81fcf7c2bf6e'
const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0]
    ]
  ]
}

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(async () => {
  await loadRecordFixture()
  vi.mocked(getCachedUserProfile).mockResolvedValue(ocUser as unknown as CartoBioUser)
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

describe('POST /api/v3/geometry/border-cut', () => {
  test('retourne la bordure calculée', async () => {
    vi.mocked(service.calculateParcelBorder).mockResolvedValue({
      parcelleSansBordure: polygon,
      bordure: null
    } as never)

    const response = await request(app.server)
      .post('/api/v3/geometry/border-cut')
      .set('Authorization', AUTH)
      .send({
        geometry: polygon,
        distance: 5,
        allBorder: false,
        isInverted: true,
        startBorderPoint: [0, 0],
        endBorderPoint: [1, 1]
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ parcelleSansBordure: polygon, bordure: null })
    expect(service.calculateParcelBorder).toHaveBeenCalledWith(polygon, 5, false, true, [0, 0], [1, 1])
  })

  test('répond 400 sans résultat', async () => {
    vi.mocked(service.calculateParcelBorder).mockResolvedValue(undefined)

    const response = await request(app.server)
      .post('/api/v3/geometry/border-cut')
      .set('Authorization', AUTH)
      .send({ geometry: polygon, distance: 5, allBorder: true, isInverted: false })

    expect(response.status).toBe(400)
  })

  test('refuse une requête anonyme', async () => {
    const response = await request(app.server)
      .post('/api/v3/geometry/border-cut')
      .send({ geometry: polygon, distance: 5, allBorder: true, isInverted: false })

    expect(response.status).toBe(401)
  })
})

describe('POST /api/v2/geometry/geometryEquals', () => {
  test('compare deux parcellaires accessibles', async () => {
    vi.mocked(service.getGeometryEquals).mockResolvedValue([])

    const response = await request(app.server)
      .post('/api/v2/geometry/geometryEquals')
      .set('Authorization', AUTH)
      .send({ payload: { old: OLD, new: NEW } })

    expect(response.status).toBe(200)
    expect(service.getGeometryEquals).toHaveBeenCalledWith({ old: OLD, new: NEW })
  })

  test('refuse un parcellaire inexistant', async () => {
    const response = await request(app.server)
      .post('/api/v2/geometry/geometryEquals')
      .set('Authorization', AUTH)
      .send({ payload: { old: 'aaaaaaaa-c3da-448f-823e-81fcf7c2bf6e', new: NEW } })

    expect(response.status).toBe(404)
    expect(service.getGeometryEquals).not.toHaveBeenCalled()
  })
})

describe('POST /api/v2/geometry/:recordId/add', () => {
  test('vérifie la géométrie en excluant la parcelle éditée', async () => {
    vi.mocked(service.verifyGeometry).mockResolvedValue({ valid: true })

    const response = await request(app.server)
      .post(`/api/v2/geometry/${OLD}/add`)
      .set('Authorization', AUTH)
      .send({ payload: { geometry: polygon, properties: { id: '2' } } })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ valid: true })
    expect(service.verifyGeometry).toHaveBeenCalledWith(polygon, OLD, '2')
  })

  test("n'exclut aucune parcelle sans identifiant", async () => {
    vi.mocked(service.verifyGeometry).mockResolvedValue({ valid: false })

    await request(app.server)
      .post(`/api/v2/geometry/${OLD}/add`)
      .set('Authorization', AUTH)
      .send({ payload: { geometry: polygon } })

    expect(service.verifyGeometry).toHaveBeenCalledWith(polygon, OLD, '')
  })
})
