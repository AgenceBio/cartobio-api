const { deleteSingleFeature, getDataGouvStats, getParcellesStats } = require('./cartobio.js')
const { get, HTTPError, TimeoutError } = require('got')
const pool = require('../db.js')
const { NotFoundApiError } = require('../errors.js')
const record = require('./__fixtures__/record.json')
const parcelles = require('./__fixtures__/parcelles.json')
const user = require('./__fixtures__/decoded-token-oc.json')
const { evvClient, evvLookup, evvParcellaire, parseAPIParcellaireStream } = require('./cartobio.js')
const { createReadStream, readFileSync } = require('fs')
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

const xmlEvv = readFileSync(join(__dirname, './__fixtures__/cvi-evv.xml'), { encoding: 'utf8' })
const xmlParcellaire = readFileSync(join(__dirname, './__fixtures__/cvi-parcellaire.xml'), { encoding: 'utf8' })

// jest.mock('got')
jest.mock('../db.js')

const clientQuery = jest.fn()
const clientRelease = jest.fn()
db.connect.mockResolvedValue({
  query: clientQuery,
  release: clientRelease
})

const mockedGet = jest.mocked(get)

beforeEach(() => jest.clearAllMocks())

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
    expect.assertions(3)
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
    expect.assertions(2)
    db.connect.mockReset()

    await expect(deleteSingleFeature({ featureId: 9999, record: normalizedRecord, user }, { reason })).rejects.toThrow(NotFoundApiError)
    expect(db.connect).not.toHaveBeenCalled()
  })
})

describe('evvLookup', () => {
  test('returns a known operator', () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockResolvedValue(xmlEvv) })

    const result = evvLookup({ numeroEvv: '01234' })

    return expect(result).resolves.toEqual({ siret: '999999999', libelle: 'test viti', numero: '01234' })
  })

  test('operator not found', () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockRejectedValue(new HTTPError({ statusCode: 404 })) })

    const result = evvLookup({ numeroEvv: '01234' })
    return expect(result).resolves.toEqual({ siret: undefined, libelle: '', numero: '01234' })
  })

  test('remote server down', () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockRejectedValue(new TimeoutError({ message: 'Request timeout' })) })

    const result = evvLookup({ numeroEvv: '01234' })
    return expect(result).rejects.toThrow("Impossible de communiquer avec l'API CVI")
  })
})

describe('evvParcelles', () => {
  test('turns an EVV into a geometry-less featureCollection', async () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockResolvedValue(xmlParcellaire) })

    const result = await evvParcellaire({ numeroEvv: '01234' })
    // https://cadastre.data.gouv.fr/map?style=ortho&parcelleId=95476000AI0520#17.03/49.06449/2.070498
    const expectation = {
      type: 'FeatureCollection',
      features: [
        {
          properties: {
            cadastre: ['95476000AI0520'],
            cultures: [
              {
                CPF: '01.21.12',
                variete: 'CHARDONNAY',
                surface: 0.0305
              }
            ]
          }
        },
        {
          properties: {
            cadastre: ['661980000A1020'],
            cultures: [
              {
                CPF: '01.21.12',
                variete: 'CARIGNAN',
                surface: 0.15
              },
              {
                CPF: '01.21.12',
                variete: 'CHARDONNAY',
                surface: 0.0262
              }
            ]
          }
        },
        {
          properties: {
            cadastre: ['012550000A1996'],
            cultures: []
          }
        }
      ]
    }

    return expect(result).toMatchObject(expectation)
  })
})

describe('parseAPIParcellaireStream', () => {
  test('turns a file into a working GeoJSON', async () => {
    expect.assertions(3)

    // @ts-ignore
    const expectation = require('./__fixtures__/agence-bio-api-parcellaire_expectation.json')
    const fixtureFile = createReadStream(join(__dirname, '__fixtures__', 'agence-bio-api-parcellaire.json'))
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }

    const generator = parseAPIParcellaireStream(fixtureFile, { organismeCertificateur })
    const { value: result } = await generator.next()

    expect(JSON.parse(JSON.stringify(result))).toMatchObject(expectation)

    await expect(generator.next()).resolves.not.toThrow()

    await expect(generator.next()).resolves.toMatchObject({
      value: {
        numeroBio: '101903',
        error: new Error('champ geom incorrect : Unexpected end of JSON input')
      }
    })
  })
})
