import request from 'supertest'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../../../src/app.js'
import { getCachedUserProfile, signAccessToken } from '../../../src/modules/auth/auth.service.js'
import * as service from '../../../src/modules/exports/exports.service.js'
import { got } from '../../got-mock.js'
import { loadRecordFixture } from '../../utils.js'
import agencebioOperator from '../../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

vi.mock('../../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn()
}))
vi.mock('../../../src/modules/exports/exports.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generatePDF: vi.fn(),
  exportDataOcId: vi.fn()
}))

const sign = (user: { id: number }): string => signAccessToken(user.id)
const ocUser = {
  id: 1,
  prenom: 'Tonio',
  nom: 'Est',
  organismeCertificateur: { id: 999, nom: 'CartobiOC' },
  groups: [{ id: '8', nom: 'Auditeur' }],
  mainGroup: { id: '8', nom: 'Auditeur' }
}
const AUTH = `Bearer ${sign(ocUser)}`
const CERTIFIED = '054f0d70-c3da-448f-823e-81fcf7c11112'
const PENDING = '054f0d70-c3da-448f-823e-81fcf7c2bf6e'

function generator(...values: unknown[]) {
  const next = vi.fn()
  values.forEach((value) => next.mockResolvedValueOnce({ value, done: false }))
  next.mockResolvedValue({ value: undefined, done: true })
  return { next } as unknown as ReturnType<typeof service.generatePDF>
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

describe('GET /api/v2/pdf/:numeroBio/:recordId', () => {
  test("retourne l'archive générée", async () => {
    vi.mocked(service.generatePDF).mockReturnValue(generator(3, 'UEsDBA=='))

    const response = await request(app.server)
      .get(`/api/v2/pdf/99999/${CERTIFIED}?force_refresh=true&pac=true`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/zip')
    expect(service.generatePDF).toHaveBeenCalledWith('99999', CERTIFIED, true, true, false)
  })

  test('répond 204 et génère en tâche de fond au-delà de 80 parcelles', async () => {
    const gen = generator(81, 'UEsDBA==')
    vi.mocked(service.generatePDF).mockReturnValue(gen)

    const response = await request(app.server).get(`/api/v2/pdf/99999/${CERTIFIED}`).set('Authorization', AUTH)

    expect(response.status).toBe(204)
    expect(gen.next).toHaveBeenCalledTimes(2)
  })

  test('refuse un numéro bio qui ne correspond pas au parcellaire', async () => {
    const response = await request(app.server).get(`/api/v2/pdf/11111/${CERTIFIED}`).set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(service.generatePDF).not.toHaveBeenCalled()
  })

  test('refuse un parcellaire non certifié', async () => {
    const response = await request(app.server).get(`/api/v2/pdf/99999/${PENDING}`).set('Authorization', AUTH)

    expect(response.status).toBe(400)
    expect(response.body.message).toBe("L'attestation n'est disponible que pour un parcellaire certifié.")
    expect(service.generatePDF).not.toHaveBeenCalled()
  })

  test('échoue si le document généré est invalide', async () => {
    vi.mocked(service.generatePDF).mockReturnValue(generator(3, undefined))

    const response = await request(app.server).get(`/api/v2/pdf/99999/${CERTIFIED}`).set('Authorization', AUTH)

    expect(response.status).toBe(500)
  })

  test('refuse une requête anonyme', async () => {
    const response = await request(app.server).get(`/api/v2/pdf/99999/${CERTIFIED}`)

    expect(response.status).toBe(401)
  })
})

describe('POST /api/v2/exportParcellaire', () => {
  test("exporte les parcellaires de l'OC de l'utilisateur", async () => {
    vi.mocked(service.exportDataOcId).mockResolvedValue([])
    const payload = { input: 'ferme', filterForSearch: {} }

    const response = await request(app.server)
      .post('/api/v2/exportParcellaire')
      .set('Authorization', AUTH)
      .send({ payload })

    expect(response.status).toBe(200)
    expect(response.body).toEqual([])
    expect(service.exportDataOcId).toHaveBeenCalledWith(999, expect.objectContaining({ input: 'ferme' }), 1)
  })

  test('refuse un corps invalide', async () => {
    const response = await request(app.server).post('/api/v2/exportParcellaire').set('Authorization', AUTH).send({})

    expect(response.status).toBe(400)
    expect(service.exportDataOcId).not.toHaveBeenCalled()
  })
})
