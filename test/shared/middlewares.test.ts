import {
  checkCertification,
  enforceAdminRole,
  enforceAnyFastifyDecorator,
  enforceOperator,
  enforceOperatorAccess,
  enforceRecordAndOperator,
  haveRightToUpdate
} from '../../src/shared/middlewares.js'
import {
  ForbiddenApiError,
  InvalidCredentialsApiError,
  NotFoundApiError,
  UnauthorizedApiError
} from '../../src/shared/errors.js'
import { hasRecordForOc } from '../../src/shared/parcellaires/parcellaires.repository.js'
import { fetchOperatorByNumeroBio, fetchUserOperators } from '../../src/clients/agence-bio.client.js'
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
  fetchUserOperators: vi.fn()
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
      const request = { method: 'GET', user: chargeCertification, record: { oc_id: 2, certification_state: 'AUDITED' } }

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

  test('OC : retour de PENDING_CERTIFICATION à AUDITED → refusé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({
        user: ocUser,
        record: { certification_state: 'PENDING_CERTIFICATION' },
        body: { certification_state: 'AUDITED' }
      })
    ).rejects.toThrow(ForbiddenApiError)
  })

  test('OC : AUDITED directement à CERTIFIED → refusé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({
        user: ocUser,
        record: { certification_state: 'AUDITED' },
        body: { certification_state: 'CERTIFIED' }
      })
    ).rejects.toThrow(ForbiddenApiError)
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

  test('OC : création directe en CERTIFIED → refusé', async () => {
    await expect(
      haveRightToUpdateAuditMiddleware({ user: ocUser, record: undefined, body: { certification_state: 'CERTIFIED' } })
    ).rejects.toThrow(ForbiddenApiError)
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
          user: buildUser({ mainGroup: { id: '1', nom: 'Admin' }, groups: [{ id: '1', nom: 'Admin' }] })
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
    const request = asFastifyRequest({ params: { numeroBio: '99999' }, user: buildUser({ id: 42 }) })

    await hook(request)

    expect(fetchUserOperators).toHaveBeenCalledWith(42)
    expect(request.operator).toBe(operator)
  })

  test('operator user (group 4) not owning the numeroBio → Forbidden', async () => {
    vi.mocked(fetchUserOperators).mockResolvedValue({ operators: [{ numeroBio: '11111' }] } as never)

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
  const hook = enforceRecordAndOperator({ queryFn, param: 'recordId' })

  beforeEach(() => {
    vi.mocked(fetchOperatorByNumeroBio).mockReset().mockResolvedValue(operator)
    queryFn.mockReset()
  })

  test('unknown record → NotFound', async () => {
    queryFn.mockResolvedValue(null)

    await expect(
      hook(asFastifyRequest({ params: { recordId: 'x' }, headers: {}, user: buildOcUser() }))
    ).rejects.toThrow(NotFoundApiError)
  })

  test('passes the user to queryFn', async () => {
    const user = buildOcUser()
    queryFn.mockResolvedValue(buildNormalizedRecord())

    await hook(asFastifyRequest({ params: { recordId: 'x' }, headers: {}, user }))

    expect(queryFn).toHaveBeenCalledWith('x', user)
  })

  test('OC owning the record → keeps audit_notes', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord({ oc_id: 1, audit_notes: 'notes' }))
    const request = asFastifyRequest({ params: { recordId: 'x' }, headers: {}, user: buildOcUser() })

    await hook(request)

    expect(request.record?.audit_notes).toBe('notes')
    expect(request.operator).toBe(operator)
  })

  test('OC not owning the record → audit_notes removed', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord({ oc_id: 2, audit_notes: 'notes' }))
    const request = asFastifyRequest({ params: { recordId: 'x' }, headers: {}, user: buildOcUser() })

    await hook(request)

    expect(request.record?.audit_notes).toBeNull()
  })

  test('operator user (group 4) → audit_notes removed', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord({ oc_id: 1, audit_notes: 'notes' }))
    vi.mocked(fetchUserOperators).mockResolvedValue({ operators: [{ numeroBio: 99999 }] } as never)
    const request = asFastifyRequest({ params: { recordId: 'x' }, headers: {}, user: buildUser() })

    await hook(request)

    expect(request.record?.audit_notes).toBeNull()
  })

  test('unknown operator → NotFound', async () => {
    queryFn.mockResolvedValue(buildNormalizedRecord())
    vi.mocked(fetchOperatorByNumeroBio).mockRejectedValue(notFound)

    await expect(
      hook(asFastifyRequest({ params: { recordId: 'x' }, headers: {}, user: buildOcUser() }))
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
      hook(asFastifyRequest({ user: buildUser(), operator: buildOperator({ organismeCertificateur: { id: 2 } }) }))
    ).resolves.toBeUndefined()
  })

  test('OC of the operator → allowed', async () => {
    await expect(
      hook(asFastifyRequest({ user: ocUser, operator: buildOperator({ organismeCertificateur: { id: 1 } }) }))
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
      hook(asFastifyRequest({ user: ocUser, operator: buildOperator({ organismeCertificateur: { id: 2 } }) }))
    ).resolves.toBeUndefined()
  })

  test('other OC → rejected', async () => {
    await expect(
      hook(asFastifyRequest({ user: ocUser, operator: buildOperator({ organismeCertificateur: { id: 2 } }) }))
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
        asFastifyRequest({ user: buildUser(), operator: buildOperator({ organismeCertificateur: { id: 2 } }) })
      )
    ).not.toThrow()
  })

  test('OC of the operator → allowed', () => {
    expect(() =>
      checkCertification(
        asFastifyRequest({ user: buildOcUser(), operator: buildOperator({ organismeCertificateur: { id: 1 } }) })
      )
    ).not.toThrow()
  })

  test('other OC → rejected', () => {
    expect(() =>
      checkCertification(
        asFastifyRequest({ user: buildOcUser(), operator: buildOperator({ organismeCertificateur: { id: 2 } }) })
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
