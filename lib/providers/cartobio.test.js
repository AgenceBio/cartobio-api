const { getDataGouvStats, getParcellesStats } = require('./cartobio.js')
const { get } = require('got')
const { TimeoutError } = require('got')
const pool = require('../db.js')

jest.mock('got')
jest.mock('../db.js')

const mockedGet = jest.mocked(get)

describe('getDataGouvStats', () => {
  test('dataset exists', () => {
    const expectation = require('./__fixtures__/datagouv-dataset.json')
    mockedGet.mockReturnValueOnce({ json: jest.fn().mockResolvedValue(expectation) })

    return expect(getDataGouvStats()).resolves.toEqual(expectation)
  })

  test('dataset does not exist (or is private)', () => {
    mockedGet.mockImplementationOnce(() => new TimeoutError())

    return expect(getDataGouvStats('aaa' /* worksaround memoization */)).resolves.toEqual({})
  })

  test('remote server cannot be reached', () => {
    mockedGet.mockReturnValueOnce({ json: jest.fn().mockRejectedValue(new TimeoutError()) })

    return expect(getDataGouvStats('bbb' /* worksaround memoization */)).resolves.toEqual({})
  })
})

describe('getParcellesStats', () => {
  test('query returns stats count', () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: 10, parcelles_count: 120 }] })
    return expect(getParcellesStats('ccc' /* worksaround memoization */)).resolves.toEqual({ count: 10, parcelles_count: 120 })
  })

  test('database query returns an error', () => {
    pool.query.mockRejectedValueOnce(new Error('Server disconnected'))
    return expect(getParcellesStats('ddd' /* worksaround memoization */)).rejects.toThrow()
  })
})
