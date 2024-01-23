const { deleteSingleFeature, getDataGouvStats, getParcellesStats } = require('./cartobio.js')
const { get } = require('got')
const { TimeoutError } = require('got')
const pool = require('../db.js')
const { NotFoundApiError } = require('../errors.js')
const record = require('./__fixtures__/record.json')
const parcelles = require('./__fixtures__/parcelles.json')
const user = require('./__fixtures__/decoded-token-oc.json')
const { parseAPIParcellaireStream } = require('./cartobio.js')
const { createReadStream } = require('fs')
const { join } = require('path')
const { normalizeRecord } = require('../outputs/record')
const db = require('../db')

const normalizedRecord = normalizeRecord({
  record: {
    ...record,
    parcelles: parcelles
  },
  operator: record.operator
})

jest.mock('got')
jest.mock('../db.js')

const clientQuery = jest.fn()
const clientRelease = jest.fn()
db.connect.mockResolvedValue({
  query: clientQuery,
  release: clientRelease
})

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

  test('successfully removes a given feature based on its id', async () => {
    const expectation = {
      ...record,
      parcelles: parcelles.filter(({ id }) => id !== featureId)
    }

    clientQuery.mockResolvedValueOnce(null) // BEGIN
    clientQuery.mockResolvedValueOnce(null) // DELETE
    clientQuery.mockResolvedValueOnce({ rows: [record] }) // UPDATE
    clientQuery.mockResolvedValueOnce(null) // COMMIT
    db.query.mockResolvedValueOnce({ rows: parcelles.filter(({ id }) => id !== featureId) }) // joinRecordParcelles

    expect(await deleteSingleFeature({ featureId, record: normalizedRecord, user }, { reason })).toEqual(expectation)
    expect(clientQuery).toHaveBeenCalledTimes(4)
    expect(clientRelease).toHaveBeenCalled()
  })

  test('throws an error when trying to remove a non-existing feature', async () => {
    db.connect.mockReset()

    await expect(deleteSingleFeature({ featureId: 9999, record: normalizedRecord, user }, { reason })).rejects.toThrow(NotFoundApiError)
    expect(db.connect).not.toHaveBeenCalled()
  })
})

describe('parseAPIParcellaireStream', () => {
  test('turns a file into a working GeoJSON', async () => {
    // @ts-ignore
    const expectation = require('./__fixtures__/agence-bio-api-parcellaire_expectation.json')
    const fixtureFile = createReadStream(join(__dirname, '__fixtures__', 'agence-bio-api-parcellaire.json'))
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }

    const generator = parseAPIParcellaireStream(fixtureFile, { organismeCertificateur })
    const { value: result } = await generator.next()

    expect(JSON.parse(JSON.stringify(result))).toMatchObject(expectation)

    await expect(async () => await generator.next()).not.toThrow()

    await expect(await generator.next()).toMatchObject({
      value: {
        numeroBio: '101903',
        error: new Error('champ geom incorrect : Unexpected end of JSON input')
      }
    })
  })
})
