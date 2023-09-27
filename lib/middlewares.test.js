const { enforceRecord } = require('./middlewares.js')
const { getOperatorById } = require('./providers/cartobio.js')
const { fetchOperatorById } = require('./providers/agence-bio.js')
const db = require('./db.js')
const { featureCollection } = require('@turf/helpers')

jest.mock('./providers/agence-bio.js', () => ({
  fetchOperatorById: jest.fn().mockResolvedValue({ id: 1 })
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
  test('replies with a null record but an operator object if the record does not exist', async () => {
    const request = {
      params: { operatorId: 'abcd' },
      record: null
    }

    const mockedFetchOperator = jest.mocked(fetchOperatorById)
    mockedFetchOperator.mockRejectedValueOnce({ statusCode: 404 })

    db.query.mockResolvedValue({ rows: [] })
    const hook = enforceRecord({ queryFn: getOperatorById, param: 'operatorId' })

    return hook(request, reply).then(() => {
      expect(reply.code).toHaveBeenCalledWith(404)
    })
  })

  test('replies with a 404 if record and operator do not exist', async () => {
    const request = {
      params: { operatorId: 'abcd' },
      record: null
    }

    const output = { operator: { id: 1 }, metadata: {}, parcelles: featureCollection([]) }

    db.query.mockResolvedValue({ rows: [] })
    const hook = enforceRecord({ queryFn: getOperatorById, param: 'operatorId' })

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject(output)
    })
  })

  test('known operator and known record', async () => {
    const request = {
      params: { operatorId: 'abcd' },
      record: null
    }

    const record = { record_id: 'abcd', parcelles: featureCollection([]), metadata: { source: 'lol' } }
    const output = { operator: { id: 1 }, record_id: 'abcd', metadata: { source: 'lol' }, parcelles: featureCollection([]) }

    db.query.mockResolvedValue({ rows: [record] })
    const hook = enforceRecord({ queryFn: getOperatorById, param: 'operatorId' })

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject(output)
    })
  })
})
