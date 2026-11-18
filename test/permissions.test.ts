import request from 'supertest'
import { createSigner } from 'fast-jwt'
import { sql } from 'drizzle-orm'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../src/app.js'
import config from '../src/config/env.js'
import { db } from '../src/database/database.js'
import { parcellaireImport } from '../src/database/schema/index.js'
import { getCachedUserProfile } from '../src/modules/auth/auth.service.js'
import { got } from './got-mock.js'
import { loadRecordFixture } from './utils.js'
import agencebioOperator from './fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

vi.mock('../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn()
}))

const sign = createSigner({ key: config.get('jwtSecret') })

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

describe('déconnexion', () => {
  const signWithExpiration = createSigner({
    key: config.get('jwtSecret'),
    expiresIn: 60 * 60 * 1000
  })

  test("révoque le jeton : il n'est plus accepté par l'API", async () => {
    const token = `Bearer ${signWithExpiration(users[1]!)}`

    expect((await request(app.server).get('/api/v2/test').set('Authorization', token)).status).toBe(200)

    const logout = await request(app.server).post('/api/auth-provider/logout').set('Authorization', token)
    expect(logout.status).toBe(200)
    expect(logout.body.logoutUrl).toContain('/oauth2/sessions/logout')

    const after = await request(app.server).get('/api/v2/test').set('Authorization', token)
    expect(after.status).toBe(401)
  })

  test("ne révoque pas les autres jetons de l'utilisateur", async () => {
    const revoked = `Bearer ${signWithExpiration({ ...users[1]!, jti: 'a' })}`
    const other = `Bearer ${signWithExpiration({ ...users[1]!, jti: 'b' })}`

    await request(app.server).post('/api/auth-provider/logout').set('Authorization', revoked)

    expect((await request(app.server).get('/api/v2/test').set('Authorization', other)).status).toBe(200)
  })

  test('refuse un jeton signé avec une autre clé, sans le révoquer', async () => {
    const forged = `Bearer ${createSigner({ key: 'autre-cle', expiresIn: 60 * 60 * 1000 })(users[1]!)}`
    const before = await snapshot()

    const response = await request(app.server).post('/api/auth-provider/logout').set('Authorization', forged)

    expect(response.status).toBe(401)
    expect(await snapshot()).toEqual(before)
  })
})
