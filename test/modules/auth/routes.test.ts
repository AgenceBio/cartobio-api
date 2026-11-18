import request from 'supertest'
import { createVerifier } from 'fast-jwt'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../../../src/app.js'
import config from '../../../src/config/env.js'
import * as service from '../../../src/modules/auth/auth.service.js'
import { encodeAuthState } from '../../../src/modules/auth/auth.utils.js'
import { buildOcUser, buildOperator } from '../../factories.js'

vi.mock('../../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyNotificationAuthorization: vi.fn(),
  fetchOperatorByNumeroBio: vi.fn(),
  getUserProfileById: vi.fn(),
  canAccessOperator: vi.fn(),
  getUserProfileFromSSOToken: vi.fn()
}))

const verify = createVerifier({ key: config.get('jwtSecret'), allowedIss: 'cartobio', allowedAud: 'cartobio' })
const user = buildOcUser() as CartoBioUser
const operator = buildOperator()

beforeAll(() => app.ready())
afterAll(() => app.close())
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('GET /api/v2/user/exchangeToken', () => {
  beforeEach(() => {
    vi.mocked(service.fetchOperatorByNumeroBio).mockResolvedValue(operator)
    vi.mocked(service.getUserProfileById).mockResolvedValue(user)
  })

  test("échange un jeton Agence Bio contre un jeton CartoBio de l'utilisateur", async () => {
    vi.mocked(service.verifyNotificationAuthorization).mockReturnValue({
      decodedToken: { numeroBio: '99999', userId: 1 },
      token: 'agence-bio'
    })
    vi.mocked(service.canAccessOperator).mockResolvedValue(true)

    const response = await request(app.server).get('/api/v2/user/exchangeToken').set('Authorization', 'Bearer x')

    expect(response.status).toBe(200)
    expect(response.body.operator).toMatchObject({ numeroBio: '99999' })
    const payload = verify(response.body.token)
    expect(payload).toMatchObject({ sub: String(user.id), typ: 'exchange', numeroBio: '99999' })
    expect(payload).not.toHaveProperty('organismeCertificateur')
    expect(payload.exp - payload.iat).toBe(2 * 60 * 60)
    expect(service.fetchOperatorByNumeroBio).toHaveBeenCalledWith('99999')
    expect(service.getUserProfileById).toHaveBeenCalledWith(1)
  })

  test('refuse un jeton invalide', async () => {
    vi.mocked(service.verifyNotificationAuthorization).mockReturnValue({
      error: new Error('signature')
    })

    const response = await request(app.server).get('/api/v2/user/exchangeToken').set('Authorization', 'Bearer x')

    expect(response.status).toBe(401)
    expect(service.fetchOperatorByNumeroBio).not.toHaveBeenCalled()
  })

  test("refuse un utilisateur sans accès à l'opérateur", async () => {
    vi.mocked(service.verifyNotificationAuthorization).mockReturnValue({
      decodedToken: { numeroBio: '99999', userId: 1 },
      token: 'agence-bio'
    })
    vi.mocked(service.canAccessOperator).mockResolvedValue(false)

    const response = await request(app.server).get('/api/v2/user/exchangeToken').set('Authorization', 'Bearer x')

    expect(response.status).toBe(403)
    expect(response.body).not.toHaveProperty('token')
  })
})

describe('POST /api/auth-provider/logout', () => {
  test("supprime la session et renvoie l'URL de déconnexion SSO", async () => {
    const { token } = await service.createSession(user.id, 'id-token-sso')

    const response = await request(app.server)
      .post('/api/auth-provider/logout')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', `cartobio_session=${token}`)

    expect(response.status).toBe(200)
    const logoutUrl = new URL(response.body.logoutUrl)
    expect(logoutUrl.pathname).toBe('/oauth2/sessions/logout')
    expect(logoutUrl.searchParams.get('id_token_hint')).toBe('id-token-sso')
    expect(logoutUrl.searchParams.get('post_logout_redirect_uri')).toBe(config.get('frontendUrl'))
    expect(([] as string[]).concat(response.headers['set-cookie'] ?? [])[0]).toMatch(/^cartobio_session=;/)
    expect(await service.endSession(token)).toBeNull()
  })

  test('accepte une déconnexion sans session', async () => {
    const response = await request(app.server)
      .post('/api/auth-provider/logout')
      .set('X-Requested-With', 'XMLHttpRequest')

    expect(response.status).toBe(200)
    expect(new URL(response.body.logoutUrl).search).toBe('')
  })

  test("refuse une déconnexion sans l'en-tête X-Requested-With", async () => {
    const { token } = await service.createSession(user.id, 'id-token-sso')

    const response = await request(app.server)
      .post('/api/auth-provider/logout')
      .set('Cookie', `cartobio_session=${token}`)

    expect(response.status).toBe(403)
    expect(await service.endSession(token)).toBe('id-token-sso')
  })
})

describe('GET /api/auth-provider/agencebio/callback', () => {
  test("ouvre une session et redirige vers le front avec l'état d'origine", async () => {
    vi.spyOn(app.agenceBioOAuth2, 'getAccessTokenFromAuthorizationCodeFlow').mockResolvedValue({
      token: { access_token: 'access', id_token: 'id-token-sso' }
    } as never)
    vi.mocked(service.getUserProfileFromSSOToken).mockResolvedValue(user)
    const state = encodeAuthState({ mode: 'oc', returnto: '/exploitations/99999' })

    const response = await request(app.server).get('/api/auth-provider/agencebio/callback').query({ state, code: 'c' })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.location!)
    expect(`${location.origin}${location.pathname}`).toBe(`${new URL(config.get('frontendUrl')).origin}/login`)
    expect(location.searchParams.get('mode')).toBe('oc')
    expect(location.searchParams.get('returnto')).toBe('/exploitations/99999')
    expect(location.hash).toBe('')
    const cookie = ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .find((value) => value.startsWith('cartobio_session='))
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Strict/)
    const sessionToken = cookie!.split(';')[0]!.split('=')[1]!
    expect(await service.endSession(sessionToken)).toBe('id-token-sso')
    expect(service.getUserProfileFromSSOToken).toHaveBeenCalledWith('access')
  })

  test('refuse un état illisible', async () => {
    const response = await request(app.server)
      .get('/api/auth-provider/agencebio/callback')
      .query({ state: 'n-importe-quoi', code: 'c' })

    expect(response.status).toBe(401)
  })

  test('refuse un échange de code qui échoue', async () => {
    vi.spyOn(app.agenceBioOAuth2, 'getAccessTokenFromAuthorizationCodeFlow').mockRejectedValue(
      new Error('Invalid state')
    )

    const response = await request(app.server)
      .get('/api/auth-provider/agencebio/callback')
      .query({ state: encodeAuthState({}), code: 'c' })

    expect(response.status).toBe(401)
    expect(response.body.message).toBe('Accès refusé : état de connexion inconnu ou expiré, veuillez vous reconnecter.')
    expect(service.getUserProfileFromSSOToken).not.toHaveBeenCalled()
  })
})

describe('GET /auth-provider/agencebio/login', () => {
  test('redirige vers la route de connexion', async () => {
    const response = await request(app.server).get('/auth-provider/agencebio/login')

    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('/api/auth-provider/agencebio/login')
  })
})

describe('GET /api/v3/external/exploitations/:numeroBio', () => {
  test("redirige vers le SSO en conservant l'exploitation visée", async () => {
    const spy = vi
      .spyOn(app.agenceBioOAuth2, 'generateAuthorizationUri')
      .mockResolvedValue('https://sso.example.com/oauth2/auth?state=abc')

    const response = await request(app.server).get('/api/v3/external/exploitations/99999')

    expect(response.status).toBe(302)
    const location = new URL(response.headers.location!)
    expect(location.searchParams.get('login_hint')).toBe('skip_consent')
    expect(location.searchParams.get('state')).toBe('abc')
    expect(spy.mock.calls[0]![0].query).toEqual({ returnto: '/exploitations/99999' })
  })

  test.each(['0', 'abc', '-1'])('refuse le numéro bio %s', async (numeroBio) => {
    const response = await request(app.server).get(`/api/v3/external/exploitations/${numeroBio}`)

    expect(response.status).toBe(400)
  })
})
