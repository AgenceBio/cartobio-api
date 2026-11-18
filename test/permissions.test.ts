import request from 'supertest'
import { createSigner } from 'fast-jwt'
import { sql } from 'drizzle-orm'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../src/app.js'
import config from '../src/config/env.js'
import { db } from '../src/database/database.js'
import { parcellaireImport, sessions } from '../src/database/schema/index.js'
import {
  createSession,
  getCachedUserProfile,
  signAccessToken,
  signExchangeToken
} from '../src/modules/auth/auth.service.js'
import { got } from './got-mock.js'
import { loadRecordFixture } from './utils.js'
import agencebioOperator from './fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

vi.mock('../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn()
}))

const sign = (user: { id: number }): string => signAccessToken(user.id)

const ocProprietaire = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }
const autreOc = { id: 1111, nom: 'Certificator', numeroControleEu: 'FR-BIO-1111' }
const users = {
  1: {
    id: 1,
    prenom: 'Tonio',
    nom: 'Est',
    organismeCertificateur: ocProprietaire,
    mainGroup: { id: 2 }
  },
  2: {
    id: 2,
    prenom: 'Tania',
    nom: 'Ouest',
    organismeCertificateur: autreOc,
    mainGroup: { id: 2 }
  },
  3: {
    id: 3,
    prenom: 'Paul',
    nom: 'Nord',
    mainGroup: { id: 4 },
    groups: [{ id: 4, nom: 'Opérateur' }]
  }
} as unknown as Record<string, CartoBioUser>
vi.mocked(getCachedUserProfile).mockImplementation(async (id) => users[id]!)

const bearer = (id: 1 | 2 | 3): string => `Bearer ${sign(users[id]!)}`

const recordId = '054f0d70-c3da-448f-823e-81fcf7c2bf6e'
const R = `/api/v2/audits/${recordId}`
const feature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [4.85, 45.75],
        [4.851, 45.75],
        [4.851, 45.751],
        [4.85, 45.751],
        [4.85, 45.75]
      ]
    ]
  },
  properties: { conversion_niveau: 'AB' }
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
const routes: Array<[Method, string, object?]> = [
  ['get', R],
  ['get', `${R}/has-attestation-production`],
  ['get', `${R}/parcelles`],
  ['post', `${R}/1/controlee`],
  ['post', `${R}/1/non-controlee`],
  ['patch', R, { version_name: 'piratage' }],
  ['delete', R],
  ['post', `${R}/parcelles`, { feature }],
  ['patch', `${R}/parcelles`, { type: 'FeatureCollection', features: [{ id: 1, properties: { NOM: 'piratage' } }] }],
  ['put', `${R}/parcelles`, { features: [feature], from: [1] }],
  ['patch', `${R}/parcelles/1`, { properties: { NOM: 'piratage' } }],
  ['delete', `${R}/parcelles/1`, { reason: { code: 'other' } }],
  ['post', `/api/v2/geometry/${recordId}/add`, { feature }],
  ['get', `/api/v2/pdf/99999/${recordId}`],
  [
    'post',
    '/api/v2/operator/99999/records',
    { version_name: 'piratage', parcelles: { type: 'FeatureCollection', features: [] } }
  ],
  ['get', '/api/v2/operator/99999'],
  ['get', '/api/v2/operator/99999/records'],
  ['get', '/api/v2/operator/99999/importData'],
  ['post', '/api/v2/operator/99999/pin'],
  ['post', '/api/v2/operator/99999/unpin'],
  ['post', '/api/v2/operator/99999/consulte'],
  ['patch', '/api/v2/operator/99999/hideNotif'],
  ['get', '/api/v2/import/geofolia/99999'],
  ['get', '/api/v2/import/evv/12345+99999']
]

async function snapshot(): Promise<Record<string, string>> {
  const { rows: tables } = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'cartobio' AND table_name NOT IN ('communes', 'departements', 'regions', 'territoires')`
  )
  const hashes: Record<string, string> = {}
  for (const { table_name } of tables) {
    const { rows } = await db.execute<{ hash: string }>(
      sql`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
          FROM cartobio.${sql.identifier(table_name)} t`
    )
    hashes[table_name] = rows[0]!.hash
  }
  return hashes
}

function send(method: Method, url: string, body: object | undefined, authorization?: string): request.Test {
  const req = request(app.server)[method](url)
  if (authorization) req.set('Authorization', authorization)
  return body ? req.send(body) : req
}

beforeAll(() => app.ready())
afterAll(() => app.close())

beforeEach(async () => {
  got.get.mockReset()
  got.post.mockReset()
  got.get.mockImplementation(((url: string) => ({
    async json() {
      return String(url).includes('/api/utilisateur/') ? [] : agencebioOperator
    }
  })) as never)
  await loadRecordFixture()
})

describe("contrôle d'accès des routes d'un parcellaire ou d'un opérateur", () => {
  test("l'OC certificateur accède bien au parcellaire", async () => {
    const response = await request(app.server).get(R).set('Authorization', bearer(1))

    expect(response.status).toBe(200)
    expect(response.body.record_id).toBe(recordId)
  })

  test('refuse chaque route sans jeton, sans modifier la base', async () => {
    const before = await snapshot()

    for (const [method, url, body] of routes) {
      const response = await send(method, url, body)
      expect({ route: `${method.toUpperCase()} ${url}`, status: response.status }).toEqual({
        route: `${method.toUpperCase()} ${url}`,
        status: 401
      })
    }

    expect(await snapshot()).toEqual(before)
  })

  test.each([
    ['un autre organisme certificateur', 2],
    ["un opérateur qui ne gère pas l'exploitation", 3]
  ] as const)('refuse chaque route à %s, sans modifier la base', async (_, userId) => {
    const before = await snapshot()

    for (const [method, url, body] of routes) {
      const response = await send(method, url, body, bearer(userId))
      expect({
        route: `${method.toUpperCase()} ${url}`,
        refused: [401, 403].includes(response.status)
      }).toEqual({
        route: `${method.toUpperCase()} ${url}`,
        refused: true
      })
    }

    expect(await snapshot()).toEqual(before)
  })
})

describe('isolation des imports entre organismes certificateurs', () => {
  const ocToken = 'jeton-oc-999'

  async function insertJob(organismeCertificateur: number): Promise<number> {
    const [job] = await db
      .insert(parcellaireImport)
      .values({ organismeCertificateur, status: 'DONE', statutJob: 'VALID', endedAt: new Date() })
      .returning({ id: parcellaireImport.id })
    return job!.id
  }

  beforeEach(() => {
    got.post.mockImplementation((() => ({
      async json() {
        return ocProprietaire
      }
    })) as never)
  })

  test("ne liste que les imports de l'organisme du jeton", async () => {
    const propre = await insertJob(999)
    const autre = await insertJob(1111)

    const response = await request(app.server).get('/api/v3/import/parcellaire-imports').set('Authorization', ocToken)

    expect(response.status).toBe(200)
    const ids = response.body.data.map(({ jobId }: { jobId: number }) => jobId)
    expect(ids).toContain(propre)
    expect(ids).not.toContain(autre)
  })

  test.each(['/api/v3/import/parcellaire-imports/', '/api/v3/import/jobs/'])(
    "renvoie 404 sur l'import d'un autre organisme (%s:id)",
    async (prefix) => {
      const autre = await insertJob(1111)
      const propre = await insertJob(999)

      const refuse = await request(app.server).get(`${prefix}${autre}`).set('Authorization', ocToken)
      const accepte = await request(app.server).get(`${prefix}${propre}`).set('Authorization', ocToken)

      expect(refuse.status).toBe(404)
      expect(accepte.status).toBe(200)
    }
  )
})

describe("jeton d'échange", () => {
  test("donne accès à l'opérateur de la notification", async () => {
    const token = `Bearer ${signExchangeToken(1, '99999')}`

    expect((await request(app.server).get(R).set('Authorization', token)).status).toBe(200)
    expect((await request(app.server).get('/api/v2/operator/99999').set('Authorization', token)).status).toBe(200)
  })

  test("refuse chaque route d'un autre opérateur, sans modifier la base", async () => {
    const token = `Bearer ${signExchangeToken(1, '88888')}`
    const before = await snapshot()

    for (const [method, url, body] of routes) {
      const response = await send(method, url, body, token)
      expect({ route: `${method.toUpperCase()} ${url}`, status: response.status }).toEqual({
        route: `${method.toUpperCase()} ${url}`,
        status: 403
      })
    }

    expect(await snapshot()).toEqual(before)
  })

  test('refuse les routes sans opérateur', async () => {
    const token = `Bearer ${signExchangeToken(1, '99999')}`

    expect((await request(app.server).get('/api/v2/test').set('Authorization', token)).status).toBe(403)
  })
})

describe('session', () => {
  const refresh = (token: string): request.Test =>
    request(app.server)
      .post('/api/auth-provider/refresh')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', `cartobio_session=${token}`)
  const sessionCookie = (response: request.Response): string | undefined =>
    ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .find((cookie) => cookie.startsWith('cartobio_session='))
  const cookieValue = (cookie: string | undefined): string => cookie!.split(';')[0]!.split('=')[1]!

  test("renouvelle la session et émet un jeton d'accès accepté par l'API", async () => {
    const { token } = await createSession(1, 'id-token-sso')

    const response = await refresh(token)

    expect(response.status).toBe(200)
    const cookie = sessionCookie(response)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Strict/)
    expect(cookie).toMatch(/Path=\/api\/auth-provider/)
    expect(cookieValue(cookie)).not.toBe(token)
    const test = await request(app.server).get('/api/v2/test').set('Authorization', `Bearer ${response.body.token}`)
    expect(test.status).toBe(200)
  })

  test("refuse un renouvellement sans l'en-tête X-Requested-With", async () => {
    const { token } = await createSession(1, null)

    const response = await request(app.server)
      .post('/api/auth-provider/refresh')
      .set('Cookie', `cartobio_session=${token}`)

    expect(response.status).toBe(400)
  })

  test.each([
    ['absente', undefined],
    ['inconnue', 'n-importe-quoi']
  ])('refuse une session %s', async (_, token) => {
    const req = request(app.server).post('/api/auth-provider/refresh').set('X-Requested-With', 'XMLHttpRequest')
    const response = token ? await req.set('Cookie', `cartobio_session=${token}`) : await req

    expect(response.status).toBe(401)
  })

  test('refuse une session expirée', async () => {
    const { token } = await createSession(1, null)
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) })

    expect((await refresh(token)).status).toBe(401)
    expect(await db.select().from(sessions)).toHaveLength(0)
  })

  test("tolère l'ancien jeton pendant le délai de grâce, sans nouvelle rotation", async () => {
    const { token } = await createSession(1, null)
    const first = await refresh(token)

    const concurrent = await refresh(token)

    expect(concurrent.status).toBe(200)
    expect(sessionCookie(concurrent)).toBeUndefined()
    expect((await refresh(cookieValue(sessionCookie(first)))).status).toBe(200)
  })

  test('révoque la session quand un ancien jeton est réutilisé après le délai de grâce', async () => {
    const { token } = await createSession(1, null)
    const first = await refresh(token)
    await db.update(sessions).set({ rotatedAt: new Date(Date.now() - 60 * 1000) })

    expect((await refresh(token)).status).toBe(401)
    expect((await refresh(cookieValue(sessionCookie(first)))).status).toBe(401)
  })

  test('la déconnexion supprime la session', async () => {
    const { token } = await createSession(1, 'id-token-sso')

    const logout = await request(app.server)
      .post('/api/auth-provider/logout')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', `cartobio_session=${token}`)

    expect(logout.status).toBe(200)
    expect(new URL(logout.body.logoutUrl).searchParams.get('id_token_hint')).toBe('id-token-sso')
    expect((await refresh(token)).status).toBe(401)
  })

  test("refuse un jeton d'accès signé avec une autre clé", async () => {
    const forged = createSigner({ key: 'autre-cle', iss: 'cartobio', aud: 'cartobio', expiresIn: 60 * 1000 })({
      sub: '1',
      typ: 'session'
    })

    const response = await request(app.server).get('/api/v2/test').set('Authorization', `Bearer ${forged}`)

    expect(response.status).toBe(401)
  })

  test.each([
    ['sans audience', { iss: 'cartobio' }],
    ["d'un autre émetteur", { iss: 'autre', aud: 'cartobio' }]
  ])("refuse un jeton d'accès %s", async (_, claims) => {
    const token = createSigner({ key: config.get('jwtSecret'), expiresIn: 60 * 1000, ...claims })({
      sub: '1',
      typ: 'session'
    })

    const response = await request(app.server).get('/api/v2/test').set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
  })
})
