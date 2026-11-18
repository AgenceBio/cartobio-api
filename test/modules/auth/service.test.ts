import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../../src/database/database.js'
import { revokedTokens } from '../../../src/database/schema/index.js'
import { fetchUserOperators } from '../../../src/clients/agence-bio.client.js'
import {
  canAccessOperator,
  isRevoked,
  revokeToken,
  verifyNotificationAuthorization
} from '../../../src/modules/auth/auth.service.js'
import { buildOcUser, buildOperator, buildUser } from '../../factories.js'

vi.mock('../../../src/clients/agence-bio.client.js')

const now = (): number => Math.floor(Date.now() / 1000)

describe('canAccessOperator', () => {
  beforeEach(() => {
    vi.mocked(fetchUserOperators).mockReset()
  })

  test("autorise un administrateur sans consulter l'API", async () => {
    const admin = buildUser({ groups: [{ id: '1', nom: 'Admin' }], mainGroup: { id: '1', nom: 'Admin' } })

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
    vi.mocked(fetchUserOperators).mockResolvedValue({ operators: [buildOperator({ numeroBio: '11111' })] })

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
    const user = buildUser({ groups: [{ id: '8', nom: 'Auditeur' }], mainGroup: { id: '8', nom: 'Auditeur' } })

    expect(await canAccessOperator(user, buildOperator({ organismeCertificateur: {} }))).toBe(false)
  })
})

describe('revokeToken / isRevoked', () => {
  test('révoque un jeton encore valide en ne stockant que son empreinte', async () => {
    await revokeToken('jeton-actif', now() + 3600)

    expect(await isRevoked('jeton-actif')).toBe(true)
    expect(await isRevoked('autre-jeton')).toBe(false)

    const rows = await db.select().from(revokedTokens)
    expect(rows.map(({ tokenHash }) => tokenHash)).not.toContain('jeton-actif')
    const [row] = await db
      .select()
      .from(revokedTokens)
      .where(eq(revokedTokens.tokenHash, createHash('sha256').update('jeton-actif').digest('hex')))
    expect(row?.expiresAt.getTime()).toBe((now() + 3600) * 1000)
  })

  test('ne stocke pas un jeton déjà expiré', async () => {
    await revokeToken('jeton-expire', now() - 1)
    await revokeToken('jeton-expirant', now())

    expect(await isRevoked('jeton-expire')).toBe(false)
    expect(await isRevoked('jeton-expirant')).toBe(false)
  })

  test('accepte de révoquer deux fois le même jeton', async () => {
    const exp = now() + 3600
    await revokeToken('jeton-double', exp)
    await expect(revokeToken('jeton-double', exp)).resolves.toBeUndefined()

    expect(await isRevoked('jeton-double')).toBe(true)
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
