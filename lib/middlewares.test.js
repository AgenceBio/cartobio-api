const { enforceRecord, haveRightToUpdate } = require('./middlewares.js')
const { NotFoundApiError } = require('./errors.js')
const { getRecord } = require('./providers/cartobio.js')
const { loadRecordFixture } = require('../test/utils')
const [record] = require('./providers/__fixtures__/records.json')

const reply = {
  code: jest.fn().mockReturnValue({
    send: jest.fn().mockImplementation((val) => val)
  })
}

describe('enforceRecord()', () => {
  beforeEach(loadRecordFixture)

  test('throws a NotFoundError if record does not exist', async () => {
    const request = {
      params: { recordId: '1ebd72f2-b071-4b8b-84dc-fa621ebd18e7' },
      record: null
    }

    const hook = enforceRecord({ queryFn: getRecord, param: 'recordId' })
    return expect(hook(request, reply)).rejects.toThrow(NotFoundApiError)
  })

  test('known operator and known record', async () => {
    const request = {
      params: { recordId: '054f0d70-c3da-448f-823e-81fcf7c2bf6e' },
      headers: {},
      record: null
    }

    const hook = enforceRecord({ queryFn: getRecord, param: 'recordId' })

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject({
        record_id: record.record_id,
        version_name: record.version_name,
        annee_reference_controle: record.annee_reference_controle,
        numerobio: record.numerobio,
        certification_state: record.certification_state,
        metadata: record.metadata
      })
    })
  })
})

describe('haveRightToUpdate()', () => {
  const haveRightToUpdateAuditMiddleware = haveRightToUpdate()

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
        user: { mainGroup: { id: 4 } },
        record: { certification_state: 'OPERATOR_DRAFT' },
        body: { properties: { NOM: 'a', surface: 12, comments: 'b' } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ NOM: 'a', surface: 12, comments: 'b' })
    })

    test('record is not a draft → restricted fields only', async () => {
      const request = {
        user: { mainGroup: { id: 4 } },
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

    test('no properties in body → nothing happens', async () => {
      const request = {
        user: { mainGroup: { id: 4 } },
        record: { certification_state: 'CERTIFIED' },
        body: { geometry: { type: 'Point' } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body).toEqual({ geometry: { type: 'Point' } })
    })
  })

  describe('user from group 8', () => {
    test('record is CERTIFIED → restricted fields only', async () => {
      const request = {
        user: { mainGroup: { id: 8 } },
        record: { certification_state: 'CERTIFIED' },
        body: { properties: { NOM: 'a', surface: 12, commentaires: 'b' } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ NOM: 'a', commentaires: 'b' })
    })

    test('record is PENDING → can change everything', async () => {
      const request = {
        user: { mainGroup: { id: 8 } },
        record: { certification_state: 'PENDING_CERTIFICATION' },
        body: { properties: { surface: 12, NOM: 'a' } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ surface: 12, NOM: 'a' })
    })
  })

  describe('user from another group', () => {
    test('no filtering regardless of state', async () => {
      const request = {
        user: { mainGroup: { id: 5 } },
        record: { certification_state: 'CERTIFIED' },
        body: { properties: { surface: 12 } }
      }

      await haveRightToUpdateAuditMiddleware(request)

      expect(request.body.properties).toEqual({ surface: 12 })
    })
  })

  test('group id is a string ("4") → filtering still applies', async () => {
    const request = {
      user: { mainGroup: { id: '4' } },
      record: { certification_state: 'CERTIFIED' },
      body: { properties: { surface: 12, NOM: 'a' } }
    }

    await haveRightToUpdateAuditMiddleware(request)

    expect(request.body.properties).toEqual({ NOM: 'a' })
  })
})
