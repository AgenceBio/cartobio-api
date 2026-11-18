import request from 'supertest'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../../../src/app.js'
import { getCachedUserProfile, signAccessToken } from '../../../src/modules/auth/auth.service.js'
import * as service from '../../../src/modules/referentiel/referentiel.service.js'

vi.mock('../../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn()
}))
vi.mock('../../../src/modules/referentiel/referentiel.service.js')

const user = {
  id: 1,
  prenom: 'Opé',
  nom: 'Rateur',
  groups: [{ id: '4', nom: 'Opérateur' }],
  mainGroup: { id: '4', nom: 'Opérateur' }
}
const AUTH = `Bearer ${signAccessToken(user.id)}`

beforeAll(() => app.ready())
afterAll(() => app.close())

describe('GET /api/v2/departements', () => {
  test('retourne les départements groupés par région', async () => {
    vi.mocked(getCachedUserProfile).mockResolvedValue(user as unknown as CartoBioUser)
    vi.mocked(service.getDepartement).mockResolvedValue({
      Bretagne: [{ code: '56', nom: 'Morbihan' }]
    })

    const response = await request(app.server).get('/api/v2/departements').set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ Bretagne: [{ code: '56', nom: 'Morbihan' }] })
  })

  test('refuse une requête anonyme', async () => {
    const response = await request(app.server).get('/api/v2/departements')

    expect(response.status).toBe(401)
  })
})
