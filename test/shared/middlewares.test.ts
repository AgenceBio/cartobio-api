import {
  checkCertification,
  compareOperatorOutputAndToken,
  decodeUserToken,
  enforceAdminRole,
  enforceAnyFastifyDecorator,
  enforceOperator,
  enforceOperatorAccess,
  enforceRecordAndOperator,
  getRequestOc,
  haveRightToUpdate,
  verifyAgenceBioToken
} from '../../src/shared/middlewares.js'
import {
  ForbiddenApiError,
  InvalidCredentialsApiError,
  NotFoundApiError,
  UnauthorizedApiError
} from '../../src/shared/errors.js'
import { hasRecordForOc } from '../../src/shared/parcellaires/parcellaires.repository.js'
import { checkOcToken, fetchOperatorByNumeroBio, fetchUserOperators } from '../../src/clients/agence-bio.client.js'
import { getCachedUserProfile, revokeToken } from '../../src/modules/auth/auth.service.js'
import config from '../../src/config/env.js'
import { createSigner } from 'fast-jwt'
import {
  asFastifyRequest,
  buildNormalizedRecord,
  buildNotification,
  buildOcUser,
  buildOperator,
  buildUser
} from '../factories.js'
import type { FastifyReply } from 'fastify'

vi.mock('../../src/clients/agence-bio.client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/clients/agence-bio.client.js')>()),
  fetchOperatorByNumeroBio: vi.fn(),
  fetchUserOperators: vi.fn(),
  checkOcToken: vi.fn()
}))

vi.mock('../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/auth/auth.service.js')>()),
  getCachedUserProfile: vi.fn()
}))

vi.mock('../../src/shared/parcellaires/parcellaires.repository.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/parcellaires/parcellaires.repository.js')>()),
  hasRecordForOc: vi.fn()
}))

const reply = { code: vi.fn(), header: vi.fn() } as unknown as FastifyReply

const notFound = Object.assign(new Error('Not Found'), { response: { statusCode: 404 } })

describe('haveRightToUpdate()', () => {
  const haveRightToUpdateAuditMiddleware = haveRightToUpdate() as (request: unknown) => Promise<void>

  describe('user is undefined', () => {
    test('does nothing (no patch filtering)', async () => {
      const request = {
        user: undefined,
        record: { certification_state: 'CERTIFIED' },
        body: { properties: { NOM: 'a', surface: 12 } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ NOM: 'a', surface: 12 })
    })
  })

  describe('user from group 4 (OPERATOR)', () => {
    test('record is a draft → op can change everything', async () => {
      const request = {
        user: { id: 1, mainGroup: { id: 4, nom: 'Opérateur' } },
        record: { certification_state: 'OPERATOR_DRAFT' },
        body: { properties: { NOM: 'a', surface: 12, comments: 'b' } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ NOM: 'a', surface: 12, comments: 'b' })
    })

    test('record is not a draft → restricted fields only', async () => {
      const request = {
        user: { id: 1, mainGroup: { id: 4, nom: 'Opérateur' } },
        record: { certification_state: 'CERTIFIED' },
        body: { properties: { NOM: 'a', surface: 12, commentaires: 'b', attente_pac: true } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({
        NOM: 'a',
        commentaires: 'b',
        attente_pac: true
      })
    })

    test('record is not a draft → geometry change refused', async () => {
      const request = {
        user: { id: 1, mainGroup: { id: 4, nom: 'Opérateur' } },
        record: { certification_state: 'CERTIFIED' },
        body: { geometry: { type: 'Point' } }
      }

      await expect(haveRightToUpdateAuditMiddleware(request)).rejects.toThrow(ForbiddenApiError)
    })

    test('record is not a draft → geometry change in a feature collection refused', async () => {
      const request = {
        user: { id: 1, mainGroup: { id: 4, nom: 'Opérateur' } },
        record: { certification_state: 'AUDITED' },
        body: { features: [{ properties: { NOM: 'a' } }, { geometry: { type: 'Polygon' } }] }
      }

      await expect(haveRightToUpdateAuditMiddleware(request)).rejects.toThrow(ForbiddenApiError)
    })

    test('record is not a draft → deletion refused', async () => {
      const request = {
        method: 'DELETE',
        user: { id: 1, mainGroup: { id: 4, nom: 'Opérateur' } },
        record: { certification_state: 'PENDING_CERTIFICATION' },
        body: { reason: { code: 'other' } }
      }

      await expect(haveRightToUpdateAuditMiddleware(request)).rejects.toThrow(ForbiddenApiError)
    })

    test('record is a draft → deletion allowed', async () => {
      const request = {
        method: 'DELETE',
        user: { id: 1, mainGroup: { id: 4, nom: 'Opérateur' } },
        record: { certification_state: 'OPERATOR_DRAFT' },
        body: { reason: { code: 'other' } }
      }

      await expect(haveRightToUpdateAuditMiddleware(request)).resolves.toBeUndefined()
    })
  })

  describe('user from group 8', () => {
    test('record is CERTIFIED → restricted fields only', async () => {
      const request = {
        user: { id: 1, mainGroup: { id: 8 } },
        record: { certification_state: 'CERTIFIED' },
        body: { properties: { NOM: 'a', surface: 12, commentaires: 'b' } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ NOM: 'a', commentaires: 'b' })
    })

    test('record is PENDING → can change everything', async () => {
      const request = {
        user: { id: 1, mainGroup: { id: 8 } },
        record: { certification_state: 'PENDING_CERTIFICATION' },
        body: { properties: { surface: 12, NOM: 'a' } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ surface: 12, NOM: 'a' })
    })
  })

  describe('OC user', () => {
    const auditeur = {
      id: 1,
      mainGroup: { id: 8 },
      groups: [{ id: 8, nom: 'Auditeur' }],
      organismeCertificateur: { id: 1, nom: 'OC' }
    }
    const chargeCertification = {
      ...auditeur,
      mainGroup: { id: 2 },
      groups: [{ id: 2, nom: 'Chargé de certification' }]
    }
    const superOc = { ...auditeur, mainGroup: { id: 3 }, groups: [{ id: 3, nom: 'Super OC' }] }

    test('record of another OC → write refused', async () => {
      const request = {
        method: 'PATCH',
        user: chargeCertification,
        record: { oc_id: 2, certification_state: 'AUDITED' },
        body: { properties: { NOM: 'a' } }
      }

      await expect(haveRightToUpdateAuditMiddleware(request)).rejects.toThrow(ForbiddenApiError)
    })

    test('record of another OC → read allowed', async () => {
      const request = {
        method: 'GET',
        user: chargeCertification,
        record: { oc_id: 2, certification_state: 'AUDITED' }
      }

      await expect(haveRightToUpdateAuditMiddleware(request)).resolves.toBeUndefined()
    })

    test('auditor on a CERTIFIED record → restricted fields only, no deletion', async () => {
      const request = {
        method: 'PATCH',
        user: auditeur,
        record: { oc_id: 1, certification_state: 'CERTIFIED' },
        body: { properties: { NOM: 'a', surface: 12 } }
      }

      await haveRightToUpdateAuditMiddleware(request)
      expect(request.body.properties).toEqual({ NOM: 'a' })

      await expect(haveRightToUpdateAuditMiddleware({ ...request, method: 'DELETE' })).rejects.toThrow(
        ForbiddenApiError
      )
    })

    test('super OC on a CERTIFIED record → no restriction', async () => {
      const request = {
        method: 'DELETE',
        user: superOc,
        record: { oc_id: 1, certification_state: 'CERTIFIED' },
        body: { reason: { code: 'other' } }
      }

      await expect(haveRightToUpdateAuditMiddleware(request)).resolves.toBeUndefined()
    })
  })

  describe('user from another group', () => {
    test('record is CERTIFIED → restricted fields only', async () => {
      const request = {
        user: { id: 1, mainGroup: { id: 5 } },
        record: { certification_state: 'CERTIFIED' },
        body: { properties: { surface: 12 } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({})
    })
  })

  test('group id is a string ("4") → filtering still applies', async () => {
    const request = {
      user: { id: 1, mainGroup: { id: '4', nom: 'Opérateur' } },
      record: { certification_state: 'CERTIFIED' },
      body: { properties: { surface: 12, NOM: 'a' } }
    }

    await haveRightToUpdateAuditMiddleware(request)

    expect(request.body.properties).toEqual({ NOM: 'a' })
  })
})

describe('haveRightToUpdate() : transitions de certification_state', () => {
  const haveRightToUpdateAuditMiddleware = haveRightToUpdate() as (request: unknown) => Promise<void>
  const ocUser = {
    id: 1,
    mainGroup: { id: 2 },
    groups: [{ id: 3, nom: 'Super OC' }],
    organismeCertificateur: { id: 1, nom: 'OC' }
  }

  test('OC : retour de PENDING_CERTIFICATION à AUDITED → autorisé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({
        user: ocUser,
        record: { certification_state: 'PENDING_CERTIFICATION' },
        body: { certification_state: 'AUDITED' }
      })
    ).resolves.toBeUndefined()
  })

  test('OC : AUDITED directement à CERTIFIED → autorisé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({
        user: ocUser,
        record: { certification_state: 'AUDITED' },
        body: { certification_state: 'CERTIFIED' }
      })
    ).resolves.toBeUndefined()
  })

  test('OC : OPERATOR_DRAFT à PENDING_CERTIFICATION → autorisé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({
        user: ocUser,
        record: { certification_state: 'OPERATOR_DRAFT' },
        body: { certification_state: 'PENDING_CERTIFICATION' }
      })
    ).resolves.toBeUndefined()
  })

  test('OC : création directe en CERTIFIED → autorisé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({
        user: ocUser,
        record: undefined,
        body: { certification_state: 'CERTIFIED' }
      })
    ).resolves.toBeUndefined()
  })

  test('admin : retour en arrière → autorisé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({
        user: { id: 1, mainGroup: { id: 1, nom: 'Admin' } },
        record: { certification_state: 'CERTIFIED' },
        body: { certification_state: 'AUDITED' }
      })
    ).resolves.toBeUndefined()
  })
})

describe('enforceAdminRole()', () => {
  const hook = enforceAdminRole()

  test('admin (group 1) → allowed', async () => {
    await expect(
      hook(
        asFastifyRequest({
          user: buildUser({
            mainGroup: { id: '1', nom: 'Admin' },
            groups: [{ id: '1', nom: 'Admin' }]
          })
        })
      )
    ).resolves.toBeUndefined()
  })

  test('numeric group id 1 → allowed', async () => {
    await expect(
      hook(asFastifyRequest({ user: { id: 1, mainGroup: { id: 1, nom: 'Admin' } } }))
    ).resolves.toBeUndefined()
  })

  test.each(['2', '4', '8'])('group %s → 403', async (id) => {
    await expect(hook(asFastifyRequest({ user: buildUser({ mainGroup: { id, nom: '' } }) }))).rejects.toThrow(
      ForbiddenApiError
    )
  })

  test('no user → 403', async () => {
    await expect(hook(asFastifyRequest({ user: null }))).rejects.toThrow(ForbiddenApiError)
  })
})

describe('enforceAnyFastifyDecorator()', () => {
  const hook = enforceAnyFastifyDecorator(['user', 'organismeCertificateur']) as (
    request: unknown,
    reply: unknown
  ) => Promise<void>

  test('user set → allowed', async () => {
    await expect(hook(asFastifyRequest({ user: buildUser() }), reply)).resolves.toBeUndefined()
    expect(reply.header).toHaveBeenCalledWith('X-Api-Version', expect.anything())
  })

  test('organismeCertificateur set → allowed', async () => {
    await expect(
      hook(asFastifyRequest({ user: null, organismeCertificateur: { id: 1 } }), reply)
    ).resolves.toBeUndefined()
  })

  test('nothing set → rejected', async () => {
    await expect(hook(asFastifyRequest({ user: null }), reply)).rejects.toThrow(InvalidCredentialsApiError)
  })
})

describe('enforceOperator()', () => {
  const hook = enforceOperator({ param: 'numeroBio' })
  const operator = buildOperator({ numeroBio: '99999' })

  beforeEach(() => {
    vi.mocked(fetchOperatorByNumeroBio).mockReset().mockResolvedValue(operator)
    vi.mocked(fetchUserOperators).mockReset()
  })

  test('missing param → NotFound', async () => {
    await expect(hook(asFastifyRequest({ params: {}, user: null }))).rejects.toThrow(NotFoundApiError)
  })

  test('operator user (group 4) owning the numeroBio → allowed', async () => {
    vi.mocked(fetchUserOperators).mockResolvedValue({ operators: [{ numeroBio: 99999 }] } as never)
    const request = asFastifyRequest({
      params: { numeroBio: '99999' },
      user: buildUser({ id: 42 })
    })

    await hook(request)

    expect(fetchUserOperators).toHaveBeenCalledWith(42)
    expect(request.operator).toBe(operator)
  })

  test('operator user (group 4) not owning the numeroBio → Forbidden', async () => {
    vi.mocked(fetchUserOperators).mockResolvedValue({
      operators: [{ numeroBio: '11111' }]
    } as never)

    await expect(hook(asFastifyRequest({ params: { numeroBio: '99999' }, user: buildUser() }))).rejects.toThrow(
      ForbiddenApiError
    )
    expect(fetchOperatorByNumeroBio).not.toHaveBeenCalled()
  })

  test('OC user → no ownership check', async () => {
    const request = asFastifyRequest({ params: { numeroBio: '99999' }, user: buildOcUser() })

    await hook(request)

    expect(fetchUserOperators).not.toHaveBeenCalled()
    expect(request.operator).toBe(operator)
  })

  test('unknown operator → NotFound', async () => {
    vi.mocked(fetchOperatorByNumeroBio).mockRejectedValue(notFound)

    await expect(hook(asFastifyRequest({ params: { numeroBio: '99999' }, user: buildOcUser() }))).rejects.toThrow(
      NotFoundApiError
    )
  })
})

describe('enforceRecordAndOperator()', () => {
  const operator = buildOperator({ numeroBio: '99999', organismeCertificateur: { id: 1 } })
  const queryFn = vi.fn()
  const RECORD_ID = '00000000-0000-4000-8000-000000000000'
  const hook = enforceRecordAndOperator({ queryFn, param: 'recordId' })

  beforeEach(() => {
    vi.mocked(fetchOperatorByNumeroBio).mockReset().mockResolvedValue(operator)
    queryFn.mockReset()
  })

  test('unknown record → NotFound', async () => {
    queryFn.mockResolvedValue(null)

    await expect(
      hook(asFastifyRequest({ params: { recordId: RECORD_ID }, headers: {}, user: buildOcUser() }))
    ).rejects.toThrow(NotFoundApiError)
  })

  test('passes the user to queryFn', async () => {
    const user = buildOcUser()
    queryFn.mockResolvedValue(buildNormalizedRecord())

    await hook(asFastifyRequest({ params: { recordId: RECORD_ID }, headers: {}, user }))

    expect(queryFn).toHaveBeenCalledWith(RECORD_ID, user)
  })

  test('OC owning the record → keeps audit_notes', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord({ oc_id: 1, audit_notes: 'notes' }))
    const request = asFastifyRequest({
      params: { recordId: RECORD_ID },
      headers: {},
      user: buildOcUser()
    })

    await hook(request)

    expect(request.record?.audit_notes).toBe('notes')
    expect(request.operator).toBe(operator)
  })

  test('OC not owning the record → audit_notes removed', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord({ oc_id: 2, audit_notes: 'notes' }))
    const request = asFastifyRequest({
      params: { recordId: RECORD_ID },
      headers: {},
      user: buildOcUser()
    })

    await hook(request)

    expect(request.record?.audit_notes).toBeNull()
  })

  test('operator user (group 4) → audit_notes removed', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord({ oc_id: 1, audit_notes: 'notes' }))
    vi.mocked(fetchUserOperators).mockResolvedValue({ operators: [{ numeroBio: 99999 }] } as never)
    const request = asFastifyRequest({
      params: { recordId: RECORD_ID },
      headers: {},
      user: buildUser()
    })

    await hook(request)

    expect(request.record?.audit_notes).toBeNull()
  })

  test('unknown operator → NotFound', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord())
    vi.mocked(fetchOperatorByNumeroBio).mockRejectedValue(notFound)

    await expect(
      hook(asFastifyRequest({ params: { recordId: RECORD_ID }, headers: {}, user: buildOcUser() }))
    ).rejects.toThrow(NotFoundApiError)
  })
})

describe('enforceOperatorAccess()', () => {
  const hook = enforceOperatorAccess()
  const ocUser = buildOcUser()

  beforeEach(() => {
    vi.mocked(hasRecordForOc).mockReset().mockResolvedValue(false)
  })

  test('no OC (operator user) → allowed', async () => {
    await expect(
      hook(
        asFastifyRequest({
          user: buildUser(),
          operator: buildOperator({ organismeCertificateur: { id: 2 } })
        })
      )
    ).resolves.toBeUndefined()
  })

  test('OC of the operator → allowed', async () => {
    await expect(
      hook(
        asFastifyRequest({
          user: ocUser,
          operator: buildOperator({ organismeCertificateur: { id: 1 } })
        })
      )
    ).resolves.toBeUndefined()
  })

  test('OC of the operator but NON ENGAGEE → rejected', async () => {
    const operator = buildOperator({
      organismeCertificateur: { id: 1 },
      notifications: buildNotification({ etatCertification: 'NON ENGAGEE' })
    })

    await expect(hook(asFastifyRequest({ user: ocUser, operator }))).rejects.toThrow(UnauthorizedApiError)
  })

  test('OC of the record → allowed', async () => {
    const request = asFastifyRequest({
      user: ocUser,
      operator: buildOperator({ organismeCertificateur: { id: 2 } }),
      record: buildNormalizedRecord({ oc_id: 1 })
    })

    await expect(hook(request)).resolves.toBeUndefined()
  })

  test('previous OC of the operator → allowed', async () => {
    vi.mocked(hasRecordForOc).mockResolvedValue(true)

    await expect(
      hook(
        asFastifyRequest({
          user: ocUser,
          operator: buildOperator({ organismeCertificateur: { id: 2 } })
        })
      )
    ).resolves.toBeUndefined()
  })

  test('other OC → rejected', async () => {
    await expect(
      hook(
        asFastifyRequest({
          user: ocUser,
          operator: buildOperator({ organismeCertificateur: { id: 2 } })
        })
      )
    ).rejects.toThrow(UnauthorizedApiError)
  })

  test('Agence Bio token OC takes precedence over user OC', async () => {
    const request = asFastifyRequest({
      organismeCertificateur: { id: 2 },
      user: ocUser,
      operator: buildOperator({ organismeCertificateur: { id: 1 } })
    })

    await expect(hook(request)).rejects.toThrow(UnauthorizedApiError)
  })
})

describe('checkCertification()', () => {
  test('no user → allowed', () => {
    expect(() => checkCertification(asFastifyRequest({ user: null }))).not.toThrow()
  })

  test('operator user (no OC) → allowed', () => {
    expect(() =>
      checkCertification(
        asFastifyRequest({
          user: buildUser(),
          operator: buildOperator({ organismeCertificateur: { id: 2 } })
        })
      )
    ).not.toThrow()
  })

  test('OC of the operator → allowed', () => {
    expect(() =>
      checkCertification(
        asFastifyRequest({
          user: buildOcUser(),
          operator: buildOperator({ organismeCertificateur: { id: 1 } })
        })
      )
    ).not.toThrow()
  })

  test('other OC → rejected', () => {
    expect(() =>
      checkCertification(
        asFastifyRequest({
          user: buildOcUser(),
          operator: buildOperator({ organismeCertificateur: { id: 2 } })
        })
      )
    ).toThrow(UnauthorizedApiError)
  })

  test('certification ARRETEE → rejected', () => {
    const operator = buildOperator({
      organismeCertificateur: { id: 1 },
      notifications: buildNotification({ etatCertification: 'ARRETEE' })
    })

    expect(() => checkCertification(asFastifyRequest({ user: buildOcUser(), operator }))).toThrow(UnauthorizedApiError)
  })
})

describe('decodeUserToken()', () => {
  const hook = decodeUserToken(config.get('jwtSecret')) as (request: unknown) => Promise<void>
  const sign = createSigner({ key: config.get('jwtSecret') })
  const ocUser = buildOcUser()
  const bearer = (payload: object) =>
    ({ headers: { authorization: `Bearer ${sign(payload)}` } }) as Record<string, unknown>

  beforeEach(() => {
    vi.mocked(getCachedUserProfile).mockReset().mockResolvedValue(ocUser)
  })

  test('ignore une requête sans jeton Bearer', async () => {
    const request: Record<string, unknown> = { headers: { authorization: 'jeton-oc' } }

    await hook(request)

    expect(request.user).toBeUndefined()
    expect(getCachedUserProfile).not.toHaveBeenCalled()
  })

  test("charge le profil à jour de l'utilisateur", async () => {
    const request = bearer({ ...ocUser, nom: 'ancien nom' })

    await hook(request)

    expect(request.user).toBe(ocUser)
    expect(getCachedUserProfile).toHaveBeenCalledWith(ocUser.id)
  })

  test('signale un jeton expiré', async () => {
    const request = bearer({ ...ocUser, exp: Math.floor(Date.now() / 1000) - 10 })

    await expect(hook(request)).rejects.toMatchObject({
      statusCode: 401,
      code: 'EXPIRED_CREDENTIALS'
    })
  })

  test('refuse un jeton signé avec une autre clé comme expiré pour déconnecter le front', async () => {
    const request = {
      headers: { authorization: `Bearer ${createSigner({ key: 'autre' })(ocUser)}` }
    }

    await expect(hook(request)).rejects.toMatchObject({
      statusCode: 401,
      code: 'EXPIRED_CREDENTIALS'
    })
  })

  test('refuse un jeton malformé', async () => {
    await expect(hook({ headers: { authorization: 'Bearer pas.un.jwt' } })).rejects.toThrow(InvalidCredentialsApiError)
  })

  test('refuse un jeton révoqué', async () => {
    const payload = { ...ocUser, nonce: 'revoque' }
    const request = bearer(payload)
    await revokeToken(
      (request.headers as { authorization: string }).authorization.slice(7),
      Math.floor(Date.now() / 1000) + 60
    )

    await expect(hook(request)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Accès refusé : Le token a été révoqué'
    })
  })

  test("refuse un compte supprimé de l'Agence Bio", async () => {
    vi.mocked(getCachedUserProfile).mockRejectedValue(notFound)

    await expect(hook(bearer(ocUser))).rejects.toMatchObject({
      statusCode: 401,
      message: "Accès refusé : votre compte n'existe plus."
    })
  })

  test('signale un portail injoignable', async () => {
    vi.mocked(getCachedUserProfile).mockRejectedValue(new Error('ETIMEDOUT'))

    await expect(hook(bearer(ocUser))).rejects.toMatchObject({ statusCode: 502 })
  })

  test('refuse un compte sans rôle CartoBio', async () => {
    vi.mocked(getCachedUserProfile).mockResolvedValue(
      buildUser({ groups: [{ id: '99', nom: 'Autre' }], mainGroup: { id: '99' } })
    )

    await expect(hook(bearer(ocUser))).rejects.toMatchObject({
      statusCode: 403,
      message: "Accès refusé : votre compte n'a pas de rôle CartoBio."
    })
  })

  test('refuse un compte OC sans organisme certificateur', async () => {
    vi.mocked(getCachedUserProfile).mockResolvedValue({
      ...ocUser,
      organismeCertificateur: undefined
    })

    await expect(hook(bearer(ocUser))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('verifyAgenceBioToken()', () => {
  const hook = verifyAgenceBioToken() as (request: unknown) => Promise<void>
  const oc = { id: 1, nom: 'OC' }

  beforeEach(() => {
    vi.mocked(checkOcToken).mockReset()
  })

  test('ignore un jeton Bearer', async () => {
    await hook({ headers: { authorization: 'Bearer x' } })

    expect(checkOcToken).not.toHaveBeenCalled()
  })

  test("renseigne l'organisme certificateur du jeton", async () => {
    vi.mocked(checkOcToken).mockResolvedValue(oc)
    const request: Record<string, unknown> = { headers: { authorization: 'jeton-oc-valide' } }

    await hook(request)

    expect(request.organismeCertificateur).toBe(oc)
  })

  test.each([400, 401, 403, 404])('refuse un jeton rejeté par le portail (%s)', async (statusCode) => {
    vi.mocked(checkOcToken).mockRejectedValue({ response: { statusCode } })

    await expect(hook({ headers: { authorization: 'jeton-oc' } })).rejects.toMatchObject({
      statusCode: 401
    })
  })

  test('signale un portail en erreur', async () => {
    vi.mocked(checkOcToken).mockRejectedValue({ response: { statusCode: 500 } })

    await expect(hook({ headers: { authorization: 'jeton-oc' } })).rejects.toMatchObject({
      statusCode: 502
    })
  })
})

describe('getRequestOc()', () => {
  test("privilégie l'OC du jeton Agence Bio", () => {
    expect(getRequestOc(asFastifyRequest({ organismeCertificateur: { id: 2 }, user: buildOcUser() }))).toEqual({
      id: 2
    })
    expect(getRequestOc(asFastifyRequest({ user: buildOcUser() }))).toMatchObject({ id: 1 })
    expect(getRequestOc(asFastifyRequest({}))).toBeUndefined()
  })
})

describe('compareOperatorOutputAndToken()', () => {
  const hook = compareOperatorOutputAndToken(getRequestOc) as unknown as (
    request: unknown,
    reply: unknown,
    payload: unknown
  ) => Promise<unknown>
  const payload = { ok: true }

  beforeEach(() => {
    vi.mocked(hasRecordForOc).mockReset().mockResolvedValue(true)
  })

  test("masque les notes d'un parcellaire d'un ancien OC à l'OC actuel", async () => {
    const request: Record<string, unknown> = {
      user: buildOcUser(),
      operator: buildOperator({ organismeCertificateur: { id: 1 } }),
      record: buildNormalizedRecord({ oc_id: 2, audit_notes: 'notes', audit_demandes: 'demandes' })
    }

    await expect(hook(request, null, payload)).resolves.toBe(payload)

    expect(request.record).toMatchObject({ audit_notes: null, audit_demandes: null })
  })

  test("conserve les notes d'un parcellaire de l'OC actuel", async () => {
    const request: Record<string, unknown> = {
      user: buildOcUser(),
      operator: buildOperator({ organismeCertificateur: { id: 1 } }),
      record: buildNormalizedRecord({ oc_id: 1, audit_notes: 'notes' })
    }

    await hook(request, null, payload)

    expect(request.record).toMatchObject({ audit_notes: 'notes' })
  })

  test("cache l'OC actuel de l'opérateur à un ancien OC", async () => {
    const operator = buildOperator({ organismeCertificateur: { id: 2, nom: 'OC actuel' } })

    await expect(hook({ user: buildOcUser(), operator }, null, payload)).resolves.toBe(payload)

    expect(operator.organismeCertificateur).toEqual({})
  })

  test('refuse un OC sans accès', async () => {
    vi.mocked(hasRecordForOc).mockResolvedValue(false)
    const operator = buildOperator({ organismeCertificateur: { id: 2 } })

    await expect(hook({ user: buildOcUser(), operator }, null, payload)).rejects.toThrow(UnauthorizedApiError)
  })

  test('laisse passer une réponse sans opérateur', async () => {
    await expect(hook({ user: buildOcUser() }, null, payload)).resolves.toBe(payload)
  })
})

describe('haveRightToUpdate() : propriétés réservées aux OC', () => {
  const hook = haveRightToUpdate() as (request: unknown) => Promise<void>
  const record = buildNormalizedRecord({
    certification_state: 'OPERATOR_DRAFT',
    parcelles: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: '1', geometry: null, properties: { conversion_niveau: 'C1' } }] as never
    }
  })

  test("refuse qu'un opérateur change le niveau de conversion", async () => {
    const request = {
      method: 'PATCH',
      user: buildUser(),
      record,
      params: { featureId: '1' },
      body: { properties: { conversion_niveau: 'AB' } }
    }

    await expect(hook(request)).rejects.toMatchObject({
      statusCode: 403,
      message: "Accès refusé : vous n'êtes pas autorisé·e à modifier la conversion des parcelles."
    })
  })

  test('accepte une valeur inchangée et retire les annotations', async () => {
    const body = {
      properties: { conversion_niveau: 'C1', annotations: [{ code: 'x' }] } as Record<string, unknown>
    }

    await hook({ method: 'PATCH', user: buildUser(), record, params: { featureId: '1' }, body })

    expect(body.properties).not.toHaveProperty('annotations')
  })

  test('refuse un niveau de conversion sur une nouvelle parcelle', async () => {
    const request = {
      method: 'POST',
      user: buildUser(),
      record,
      params: {},
      body: { feature: { properties: { conversion_niveau: 'AB' } } }
    }

    await expect(hook(request)).rejects.toThrow(ForbiddenApiError)
  })

  test('accepte une découpe qui conserve le niveau de la parcelle source', async () => {
    const request = {
      method: 'PUT',
      user: buildUser(),
      record,
      params: {},
      body: { from: ['1'], features: [{ properties: { conversion_niveau: 'C1' } }] }
    }

    await expect(hook(request)).resolves.toBeUndefined()
  })

  test("laisse l'OC modifier le niveau de conversion", async () => {
    const request = {
      method: 'PATCH',
      user: buildOcUser({ groups: [{ id: '8', nom: 'Auditeur' }], mainGroup: { id: '8' } }),
      record: { ...record, oc_id: 1 },
      params: { featureId: '1' },
      body: { properties: { conversion_niveau: 'AB' } }
    }

    await expect(hook(request)).resolves.toBeUndefined()
  })
})
