const { enforceRecord } = require('./middlewares.js')
const { getOperator } = require('./providers/cartobio.js')
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
  test('replies with a 404 if the record does not exist', async () => {
    const request = {
      params: { operatorId: 'abcd' },
      record: null
    }

    const output = { operator: { id: 1 }, metadata: {}, parcelles: featureCollection([]) }

    db.query.mockResolvedValue({ rows: [] })
    const hook = enforceRecord({ queryFn: getOperator, fieldId: 'operatorId' })

    return hook(request, reply).then(() => {
      expect(reply.code).toHaveBeenCalledWith(404)
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
    const hook = enforceRecord({ queryFn: getOperator, fieldId: 'operatorId' })

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject(output)
    })
  })
})
