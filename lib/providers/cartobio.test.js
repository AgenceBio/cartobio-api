const { deleteSingleFeature, getDataGouvStats, getParcellesStats } = require('./cartobio.js')
const { get } = require('got')
const { TimeoutError } = require('got')
const pool = require('../db.js')
const { NotFoundApiError } = require('../errors.js')
const record = require('./__fixtures__/record-with-features.json')
const decodedToken = require('./__fixtures__/decoded-token-oc.json')
const { parseAPIParcellaireStream } = require('./cartobio.js')
const { createReadStream } = require('fs')
const { join } = require('path')

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

describe('deleteSingleFeature', () => {
  const featureId = 1
  const reason = {
    code: 'other',
    details: 'parce que'
  }

  test('successfully removes a given feature based on its id', () => {
    const expectation = {
      ...record,
      parcelles: {
        ...record.parcelles,
        // we expect parcelle #1 to have been removed
        features: record.parcelles.features.filter(({ id }) => id !== featureId)
      }
    }

    pool.query.mockResolvedValueOnce({ rows: [expectation] })

    return expect(deleteSingleFeature({ featureId, record, decodedToken }, { reason })).resolves.toEqual(expectation)
  })

  test('throws an error when trying to remove a non-existing feature', () => {
    return expect(deleteSingleFeature({ featureId: 9999, record, decodedToken }, { reason })).rejects.toThrow(NotFoundApiError)
  })
})

describe('parseAPIParcellaireStream', () => {
  test('turns a file into a working GeoJSON', async () => {
    const expectation = require('./__fixtures__/agence-bio-api-parcellaire_expectation.json')
    const fixtureFile = createReadStream(join(__dirname, '__fixtures__', 'agence-bio-api-parcellaire.json'))
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }

    const generator = parseAPIParcellaireStream(fixtureFile, { organismeCertificateur })
    const { value: result } = await generator.next()

    expect(JSON.parse(JSON.stringify(result))).toEqual(expectation)

    await expect(async () => await generator.next()).not.toThrow()

    await expect(await generator.next()).toMatchObject({
      value: [
        '101903',
        null,
        new Error('champ geom incorrect : Unexpected end of JSON input')
      ]
    })
  })
})
