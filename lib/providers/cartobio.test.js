const { getDataGouvStats, getParcellesStats } = require('./cartobio.js')
const { get } = require('got')
const { TimeoutError } = require('got')
const pool = require('../db.js')

jest.mock('got')
jest.mock('../db.js')

const mockedGet = jest.mocked(get)

describe('getDataGouvStats', () => {
  test('dataset exists', async () => {
    const expectation = require('./__fixtures__/datagouv-dataset.json')
    mockedGet.mockReturnValueOnce({ json: jest.fn().mockResolvedValue(expectation) })

    expect(await getDataGouvStats()).toEqual(expectation)
  })

  test('dataset does not exist (or is private)', async () => {
    mockedGet.mockImplementationOnce(() => new TimeoutError())

    expect(await getDataGouvStats('aaa' /* worksaround memoization */)).toEqual({})
  })

  test('remote server cannot be reached', async () => {
    mockedGet.mockReturnValueOnce({ json: jest.fn().mockRejectedValue(new TimeoutError()) })

    expect(await getDataGouvStats('bbb' /* worksaround memoization */)).toEqual({})
  })
})

describe('getParcellesStats', () => {
  test('query returns stats count', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: 10, parcelles_count: 120 }] })
    expect(await getParcellesStats()).toEqual({ count: 10, parcelles_count: 120 })
  })

  test.skip('database query returns an error', async () => {
    pool.query.mockRejectedValueOnce(new Error('Server disconnected'))
    expect(() => getParcellesStats()).toThrow()
  })
})
