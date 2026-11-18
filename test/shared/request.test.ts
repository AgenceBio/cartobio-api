import {
  requireOcUser,
  requireOperator,
  requireOrganismeCertificateur,
  requireRecord,
  requireUser
} from '../../src/shared/request.js'
import { asFastifyRequest, buildNormalizedRecord, buildOcUser, buildOperator, buildUser } from '../factories.js'

describe('requireUser', () => {
  test("retourne l'utilisateur authentifié", () => {
    const user = buildUser()
    expect(requireUser(asFastifyRequest({ user }))).toBe(user)
  })

  test('rejette une requête anonyme en 401', () => {
    expect(() => requireUser(asFastifyRequest({}))).toThrow(expect.objectContaining({ statusCode: 401 }))
  })
})

describe('requireOcUser', () => {
  test("retourne l'utilisateur OC", () => {
    const user = buildOcUser()
    expect(requireOcUser(asFastifyRequest({ user }))).toEqual(user)
  })

  test('rejette un utilisateur sans OC en 403', () => {
    expect(() => requireOcUser(asFastifyRequest({ user: buildUser() }))).toThrow(
      expect.objectContaining({
        statusCode: 403,
        message: 'Accès refusé : Accès réservé aux organismes certificateurs'
      })
    )
  })

  test('rejette une requête anonyme en 401', () => {
    expect(() => requireOcUser(asFastifyRequest({}))).toThrow(expect.objectContaining({ statusCode: 401 }))
  })
})

describe('requireOperator / requireRecord / requireOrganismeCertificateur', () => {
  test('retournent la valeur résolue par les middlewares', () => {
    const operator = buildOperator()
    const record = buildNormalizedRecord()
    const organismeCertificateur = { id: 1, nom: 'OC' }
    const request = asFastifyRequest({ operator, record, organismeCertificateur })

    expect(requireOperator(request)).toBe(operator)
    expect(requireRecord(request)).toBe(record)
    expect(requireOrganismeCertificateur(request)).toBe(organismeCertificateur)
  })

  test('échouent en 404 ou 401 quand la valeur est absente', () => {
    const request = asFastifyRequest({})

    expect(() => requireOperator(request)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => requireRecord(request)).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => requireOrganismeCertificateur(request)).toThrow(expect.objectContaining({ statusCode: 401 }))
  })
})
