const { enforceRecord } = require('./middlewares.js')
const { NotFoundApiError } = require('./errors.js')
const { getOperatorByNumeroBio } = require('./providers/cartobio.js')
const { fetchOperatorByNumeroBio } = require('./providers/agence-bio.js')
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
  test('throws a NotFoundError if operator cannot be found', async () => {
    const request = {
      params: { numeroBio: 1 },
      record: null
    }

    const mockedFetchOperator = jest.mocked(fetchOperatorByNumeroBio)
    mockedFetchOperator.mockRejectedValueOnce({ statusCode: 404 })

    db.query.mockResolvedValue({ rows: [] })
    const hook = enforceRecord({ queryFn: getOperatorByNumeroBio, param: 'numeroBio' })

    return expect(hook(request)).rejects.toThrow(NotFoundApiError)
  })

  test('replies with a 404 if record and operator do not exist', async () => {
    const request = {
      params: { numeroBio: 1 },
      record: null
    }

    const output = { operator: { numeroBio: 1 }, metadata: {}, parcelles: featureCollection([]) }

    db.query.mockResolvedValue({ rows: [] })
    const hook = enforceRecord({ queryFn: getOperatorByNumeroBio, param: 'numeroBio' })

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject(output)
    })
  })

  test('known operator and known record', async () => {
    const request = {
      params: { numeroBio: 1 },
      record: null
    }

    const record = { record_id: 'abcd', numerobio: '1', parcelles: featureCollection([]), metadata: { source: 'lol' } }
    const output = { operator: { numeroBio: 1 }, numerobio: '1', record_id: 'abcd', metadata: { source: 'lol' }, parcelles: featureCollection([]) }

    db.query.mockResolvedValue({ rows: [record] })
    const hook = enforceRecord({ queryFn: getOperatorByNumeroBio, param: 'numeroBio' })

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject(output)
    })
  })
})
