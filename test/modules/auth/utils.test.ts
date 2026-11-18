import {
  decodeAuthState,
  encodeAuthState,
  isAdmin,
  isOc,
  isOcAudit,
  isOcCertif,
  isOperatorUser,
  requiresOrganismeCertificateur
} from '../../../src/modules/auth/auth.utils.js'
import { buildUser } from '../../factories.js'

const encode = (value: unknown): string => `nonce.${Buffer.from(JSON.stringify(value)).toString('base64url')}`

describe('encodeAuthState / decodeAuthState', () => {
  test("restitue l'état encodé", () => {
    const state = { mode: 'oc', returnto: '/exploitations/12345' }

    expect(decodeAuthState(encodeAuthState(state))).toEqual(state)
  })

  test('préfixe chaque état par un identifiant unique', () => {
    const [first, second] = [encodeAuthState({}), encodeAuthState({})]

    expect(first).not.toBe(second)
    expect(first.split('.')[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('ignore les propriétés inconnues', () => {
    expect(decodeAuthState(encode({ returnto: '/', admin: true }))).toEqual({ returnto: '/' })
  })

  test.each([
    ['sans partie encodée', 'nonce'],
    ['avec un contenu qui n’est pas du JSON', `nonce.${Buffer.from('pas du json').toString('base64url')}`],
    ['avec un JSON null', encode(null)],
    ['avec des propriétés mal typées', encode({ mode: 1 })]
  ])('rejette un état %s', (_, state) => {
    expect(() => decodeAuthState(state)).toThrow(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' }) as Error
    )
  })
})

describe('rôles utilisateur', () => {
  const withGroups = (...ids: Array<string | number>) =>
    buildUser({
      groups: ids.map((id) => ({ id: String(id), nom: '' })),
      mainGroup: { id: undefined, nom: '' }
    })

  test.each([
    [
      'admin',
      withGroups('1'),
      { admin: true, operator: false, oc: true, requiresOc: false, certif: true, audit: true }
    ],
    [
      'chargé de certification',
      withGroups('2'),
      { admin: false, operator: false, oc: true, requiresOc: true, certif: true, audit: false }
    ],
    [
      'super OC',
      withGroups('3'),
      { admin: false, operator: false, oc: true, requiresOc: true, certif: true, audit: true }
    ],
    [
      'opérateur',
      withGroups('4'),
      { admin: false, operator: true, oc: false, requiresOc: false, certif: false, audit: false }
    ],
    [
      'auditeur',
      withGroups('8'),
      { admin: false, operator: false, oc: true, requiresOc: true, certif: false, audit: true }
    ],
    [
      'sans groupe connu',
      withGroups('99'),
      { admin: false, operator: false, oc: false, requiresOc: false, certif: false, audit: false }
    ]
  ])('%s', (_, user, expected) => {
    expect({
      admin: isAdmin(user),
      operator: isOperatorUser(user),
      oc: isOc(user),
      requiresOc: requiresOrganismeCertificateur(user),
      certif: isOcCertif(user),
      audit: isOcAudit(user)
    }).toEqual(expected)
  })

  test('prend en compte le groupe principal même absent de la liste des groupes', () => {
    const user = buildUser({ groups: [], mainGroup: { id: '1', nom: 'Admin' } })

    expect(isAdmin(user)).toBe(true)
  })

  test('accepte des identifiants de groupe numériques', () => {
    const user = buildUser({
      groups: [{ id: 1 as unknown as string, nom: 'Admin' }],
      mainGroup: { nom: '' }
    })

    expect(isAdmin(user)).toBe(true)
  })

  test('refuse tous les rôles sans utilisateur', () => {
    for (const check of [isAdmin, isOperatorUser, isOc, requiresOrganismeCertificateur, isOcCertif, isOcAudit]) {
      expect(check(null)).toBe(false)
      expect(check(undefined)).toBe(false)
    }
  })
})
