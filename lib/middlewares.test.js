const { enforceRecord } = require('./middlewares.js')
const { NotFoundApiError } = require('./errors.js')
const { getRecord } = require('./providers/cartobio.js')
const db = require('./db.js')
const { featureCollection } = require('@turf/helpers')

jest.mock('./providers/agence-bio.js', () => ({
  fetchOperatorByNumeroBio: jest.fn().mockResolvedValue({ numeroBio: 1 })
}))

jest.mock('./db.js', () => ({
  query: jest.fn()
}))

const reply = {
  code: jest.fn().mockReturnValue({
    send: jest.fn().mockImplementation((val) => val)
  })
}

afterEach(() => jest.clearAllMocks())

describe('enforceRecord()', () => {
  test('throws a NotFoundError if record does not exist', async () => {
    const request = {
      params: { recordId: '1ebd72f2-b071-4b8b-84dc-fa621ebd18e7' },
      record: null
    }

    db.query.mockResolvedValue({ rows: [] })
    const hook = enforceRecord({ queryFn: getRecord, param: 'recordId' })

    return expect(hook(request, reply)).rejects.toThrow(NotFoundApiError)
  })

  test('known operator and known record', async () => {
    const request = {
      params: { recordId: '1ebd72f2-b071-4b8b-84dc-fa621ebd18e7' },
      record: null
    }

    const record = { record_id: 'abcd', numerobio: '1', metadata: { source: 'lol' } }
    const output = { numerobio: '1', record_id: 'abcd', metadata: { source: 'lol' }, parcelles: featureCollection([]) }

    db.query.mockResolvedValueOnce({ rows: [record] }) // operator
    db.query.mockResolvedValueOnce({ rows: [] }) // parcelles
    const hook = enforceRecord({ queryFn: getRecord, param: 'recordId' })

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject(output)
    })
  })
})
