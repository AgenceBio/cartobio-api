import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../../src/database/database.js'
import { sessions } from '../../../src/database/schema/index.js'
import { fetchUserOperators } from '../../../src/clients/agence-bio.client.js'
import {
  canAccessOperator,
  createSession,
  endSession,
  getUserProfileById,
  getUserProfileFromSSOToken,
  verifyNotificationAuthorization
} from '../../../src/modules/auth/auth.service.js'
import { buildOcUser, buildOperator, buildUser } from '../../factories.js'
import { get, HTTPError } from '../../got-mock.js'

vi.mock('../../../src/clients/agence-bio.client.js')

describe('canAccessOperator', () => {
  beforeEach(() => {
    vi.mocked(fetchUserOperators).mockReset()
  })

  test("autorise un administrateur sans consulter l'API", async () => {
    const admin = buildUser({
      groups: [{ id: '1', nom: 'Admin' }],
      mainGroup: { id: '1', nom: 'Admin' }
    })

    expect(await canAccessOperator(admin, buildOperator())).toBe(true)
    expect(fetchUserOperators).not.toHaveBeenCalled()
  })

  test("autorise un opérateur sur l'un de ses opérateurs, même si les types de numéro bio diffèrent", async () => {
    vi.mocked(fetchUserOperators).mockResolvedValue({
      operators: [buildOperator({ numeroBio: '11111' }), buildOperator({ numeroBio: 12345 as unknown as string })]
    })

    expect(await canAccessOperator(buildUser({ id: 42 }), buildOperator({ numeroBio: '12345' }))).toBe(true)
    expect(fetchUserOperators).toHaveBeenCalledWith(42)
  })

  test("refuse un opérateur sur un opérateur qui n'est pas le sien", async () => {
    vi.mocked(fetchUserOperators).mockResolvedValue({
      operators: [buildOperator({ numeroBio: '11111' })]
    })

    expect(await canAccessOperator(buildUser(), buildOperator({ numeroBio: '12345' }))).toBe(false)
  })

  test("autorise un OC sur un opérateur qu'il certifie", async () => {
    const operator = buildOperator({ organismeCertificateur: { id: 1, nom: 'OC' } })

    expect(await canAccessOperator(buildOcUser(), operator)).toBe(true)
    expect(fetchUserOperators).not.toHaveBeenCalled()
  })

  test('refuse un OC sur un opérateur certifié par un autre organisme', async () => {
    const operator = buildOperator({ organismeCertificateur: { id: 2, nom: 'Autre OC' } })

    expect(await canAccessOperator(buildOcUser(), operator)).toBe(false)
  })

  test('refuse un OC sur un opérateur sans organisme certificateur', async () => {
    expect(await canAccessOperator(buildOcUser(), buildOperator({ organismeCertificateur: {} }))).toBe(false)
  })

  test("refuse un utilisateur sans organisme certificateur même si l'opérateur n'en a pas", async () => {
    const user = buildUser({
      groups: [{ id: '8', nom: 'Auditeur' }],
      mainGroup: { id: '8', nom: 'Auditeur' }
    })

    expect(await canAccessOperator(user, buildOperator({ organismeCertificateur: {} }))).toBe(false)
  })
})

describe('createSession / endSession', () => {
  test("ne stocke que l'empreinte du jeton de session", async () => {
    const { token, expiresAt } = await createSession(1, 'id-token-sso')

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, createHash('sha256').update(token).digest('hex')))
    expect(row).toMatchObject({ userId: 1, idToken: 'id-token-sso', expiresAt })
    expect((await db.select().from(sessions)).map(({ tokenHash }) => tokenHash)).not.toContain(token)
  })

  test('supprime la session et renvoie son id_token', async () => {
    const { token } = await createSession(1, 'id-token-sso')

    expect(await endSession(token)).toBe('id-token-sso')
    expect(await endSession(token)).toBeNull()
  })
})

describe('verifyNotificationAuthorization', () => {
  test.each([
    ['absent', undefined],
    ['vide', 'Bearer '],
    [
      'non signé',
      `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"numeroBio":"1","userId":1}').toString('base64url')}.`
    ],
    ['malformé', 'Bearer pas-un-jwt']
  ])('retourne une erreur pour un jeton %s', (_, header) => {
    const result = verifyNotificationAuthorization(header)

    expect(result.error).toBeDefined()
    expect(result.decodedToken).toBeUndefined()
    expect(result.token).toBeUndefined()
  })
})

const unsignedJwt = (payload: object): string =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`

const profiles: Record<string, object> = {
  '/api/users/10': {
    id: 10,
    prenom: 'Jeanne',
    nom: 'Dupont',
    organismeCertificateurId: 1,
    groupes: [
      { id: 8, nom: 'Auditeur' },
      { id: 2, nom: 'Chargé de certification' }
    ]
  },
  '/api/users/11': { id: 11, prenom: null, nom: null, organismeCertificateurId: 99, groupes: [] },
  '/api/users/12': { id: 12, groupes: [{ id: 4, nom: 'Opérateur' }] }
}

describe('profil utilisateur', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockImplementation((url: string) => ({
      async json() {
        if (url.endsWith('/api/oc')) return [{ id: 1, nom: "CartoBi'OC" }]
        if (url.endsWith('/api/utilisateur/by-email')) return { id: 10 }
        const path = Object.keys(profiles).find((key) => url.endsWith(key))
        if (!path) throw new Error(`URL inattendue ${url}`)
        return profiles[path]
      }
    }))
  })

  test("construit le profil avec le nom de l'OC et le groupe principal", async () => {
    expect(await getUserProfileById(10)).toEqual({
      id: 10,
      prenom: 'Jeanne',
      nom: 'Dupont',
      organismeCertificateur: { id: 1, nom: "CartoBi'OC" },
      groups: [
        { id: 8, nom: 'Auditeur' },
        { id: 2, nom: 'Chargé de certification' }
      ],
      mainGroup: { id: 8, nom: 'Auditeur' }
    })
  })

  test('tolère un OC inconnu et des noms absents', async () => {
    expect(await getUserProfileById(11)).toEqual({
      id: 11,
      prenom: '',
      nom: '',
      organismeCertificateur: { id: 99, nom: '' },
      groups: [],
      mainGroup: { id: undefined, nom: undefined }
    })
  })

  test("n'ajoute pas d'OC à un utilisateur qui n'en a pas", async () => {
    expect(await getUserProfileById(12)).not.toHaveProperty('organismeCertificateur')
  })

  test("retrouve l'utilisateur par l'email du jeton SSO", async () => {
    const profile = await getUserProfileFromSSOToken(unsignedJwt({ sub: 'jeanne@example.com' }))

    expect(profile.id).toBe(10)
    const byEmailCall = get.mock.calls.find(([url]) => String(url).endsWith('/api/utilisateur/by-email'))
    expect(byEmailCall![1]).toMatchObject({ searchParams: { email: 'jeanne@example.com' } })
  })

  test('refuse un jeton SSO sans sujet', async () => {
    await expect(getUserProfileFromSSOToken(unsignedJwt({ email: 'x@example.com' }))).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })
})

describe('getHistoryUser', () => {
  let getHistoryUser: typeof import('../../../src/modules/auth/auth.service.js').getHistoryUser

  beforeAll(async () => {
    ;({ getHistoryUser } = await vi.importActual<typeof import('../../../src/modules/auth/auth.service.js')>(
      '../../../src/modules/auth/auth.service.js'
    ))
  })

  beforeEach(() => {
    get.mockReset()
  })

  test('retourne un utilisateur supprimé quand le profil est introuvable', async () => {
    const notFound = Object.assign(new HTTPError(), { response: { statusCode: 404 } })
    get.mockReturnValue({ json: () => Promise.reject(notFound) })

    expect(await getHistoryUser('404', 'Auditeur')).toEqual({
      id: 404,
      nom: 'Utilisateur supprimé',
      prenom: '',
      groups: [],
      mainGroup: { nom: 'Auditeur' }
    })
  })

  test('retourne un utilisateur inconnu pour les autres erreurs', async () => {
    const serverError = Object.assign(new HTTPError(), { response: { statusCode: 500 } })
    get.mockReturnValue({ json: () => Promise.reject(serverError) })

    expect(await getHistoryUser(500, null)).toEqual({
      id: 500,
      nom: 'Utilisateur inconnu',
      prenom: '',
      groups: [],
      mainGroup: { nom: null }
    })
  })
})
