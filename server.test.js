const app = require('./server.js')
const config = require('./lib/config.js')
const request = require('supertest')
const { createSigner } = require('fast-jwt')
const got = require('got')
const fs = require('node:fs')
const { join } = require('node:path')
const db = require('./lib/db.js')

const agencebioOperator = require('./lib/providers/__fixtures__/agence-bio-operateur.json')
const record = require('./lib/providers/__fixtures__/record.json')
const parcelles = require('./lib/providers/__fixtures__/parcelles.json')
const parcellesPatched = require('./lib/providers/__fixtures__/parcelles-patched.json')
const apiParcellaire = require('./lib/providers/__fixtures__/agence-bio-api-parcellaire.json')
const { normalizeRecord } = require('./lib/outputs/record')
const { getRandomFeatureId } = require('./lib/outputs/features')
const { recordToApi } = require('./lib/outputs/api')

const sign = createSigner({ key: config.get('jwtSecret') })

const fakeOcToken = 'aaaa-bbbb-cccc-dddd'
const fakeOc = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }
const USER_DOC_AUTH_TOKEN = sign({ ocId: 999, test: true, organismeCertificateur: fakeOc })
const USER_DOC_AUTH_HEADER = `Bearer ${USER_DOC_AUTH_TOKEN}`

// start and stop server
beforeAll(() => app.ready())
afterAll(() => app.close())
afterEach(() => jest.clearAllMocks())

jest.mock('got')
jest.mock('./lib/db.js', () => ({
  query: jest.fn(),
  connect: jest.fn()
}))
jest.mock('./lib/outputs/features', () => ({
  ...jest.requireActual('./lib/outputs/features'),
  getRandomFeatureId: jest.fn()
}))

const clientQuery = jest.fn()
const clientRelease = jest.fn()
db.connect.mockResolvedValue({
  query: clientQuery,
  release: clientRelease
})

describe('GET /', () => {
  test('responds with a 404', () => {
    return request(app.server)
      .get('/')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(404)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('error', 'Not Found')
      })
  })
})

describe('GET /api/version', () => {
  test('responds with package.json version value', () => {
    return request(app.server)
      .get('/api/version')
      .type('json')
      .then((response) => {
        expect(response.body).toHaveProperty('version', config.get('version'))
      })
  })

  test('responds with not found', () => {
    return request(app.server)
      .get('/api/v1/version')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(404)
      })
  })
})

describe('GET /api/v2/user/verify', () => {
  test('responds with cartobio decoded token', () => {
    return request(app.server)
      .get('/api/v2/user/verify')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toHaveProperty('ocId', 999)
      })
  })

  test('responds well with an access_token query string value', () => {
    const postMock = jest.mocked(got.post)

    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })

    return request(app.server)
      .get('/api/v2/user/verify')
      .set('Authorization', fakeOcToken)
      .type('json')
      .then((response) => {
        expect(response.body).toEqual(fakeOc)
      })
  })
})

describe('GET /api/v2/test', () => {
  test('fails when JWT is missing, or invalid', () => {
    return request(app.server)
      .get('/api/v2/test')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(401)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('error')
      })
  })

  test('responds well with an Authorization header', () => {
    return request(app.server)
      .get('/api/v2/test')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toEqual({ message: 'OK' })
      })
  })

  test('responds well with an access_token query string value', () => {
    return request(app.server)
      .get('/api/v2/test')
      .query({ access_token: USER_DOC_AUTH_TOKEN })
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(200)
      })
  })
})

describe('POST /api/v2/convert/shapefile/geojson', () => {
  test('it converts a L93 zipped archive into WGS84 GeoJSON', () => {
    return request(app.server)
      .post('/api/v2/convert/shapefile/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', 'test/fixtures/telepac-parcelles.zip')
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toHaveProperty('features.0.type', 'Feature')
      })
  })

  test('it fails without auth', () => {
    return request(app.server)
      .post('/api/v2/convert/shapefile/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/telepac-parcelles.zip')
      .then((response) => {
        expect(response.status).toEqual(401)
      })
  })
})

describe('POST /api/v2/convert/telepac-xml/geojson', () => {
  const UUIDRe = /^[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+$/

  test('it converts a L93 multi-feature XML file to WGS84 GeoJSON', () => {
    getRandomFeatureId.mockReturnValueOnce('1').mockReturnValueOnce('2').mockReturnValueOnce('3')

    return request(app.server)
      .post('/api/v2/convert/telepac-xml/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', 'test/fixtures/telepac-dossier.xml')
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toMatchObject({
          type: 'FeatureCollection',
          features: [
            {
              id: '1',
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  expect.arrayContaining([[6.0768655089466765, 47.685278906089444]]),
                  expect.arrayContaining([[6.07727679068216, 47.68682804163941]]),
                  expect.arrayContaining([[6.0770187939092795, 47.688111446343]])
                ]
              },
              properties: {
                id: '1',
                remoteId: '1.1',
                COMMUNE: '70421',
                NUMERO_I: '1',
                NUMERO_P: '1',
                PACAGE: '999000000',
                conversion_niveau: 'CONV',
                cultures: [
                  {
                    CPF: '01.19.10.11',
                    TYPE: 'PTR',
                    id: expect.stringMatching(UUIDRe)
                  }
                ]
              }
            },
            {
              id: '2',
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  expect.arrayContaining([[6.065424536564729, 47.68858541466545]])
                ]
              },
              properties: {
                id: '2',
                remoteId: '2.2',
                COMMUNE: '70421',
                NUMERO_I: '2',
                NUMERO_P: '2',
                PACAGE: '999000000',
                conversion_niveau: 'CONV',
                cultures: [
                  {
                    CPF: '01.19.10.12',
                    TYPE: 'PPH',
                    id: expect.stringMatching(UUIDRe)
                  }
                ]
              }
            },
            {
              type: 'Feature',
              id: '3',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  expect.arrayContaining([[6.069309706237855, 47.6882033150393]])
                ]
              },
              properties: {
                id: '3',
                remoteId: '2.4',
                COMMUNE: '70421',
                NUMERO_I: '2',
                NUMERO_P: '4',
                PACAGE: '999000000',
                conversion_niveau: 'AB?',
                cultures: [
                  {
                    CPF: '01.11.12',
                    TYPE: 'BTH',
                    id: expect.stringMatching(UUIDRe)
                  }
                ]
              }
            }
          ]
        })
      })
  })

  test('it converts a L93 single-feature XML file to WGS84 GeoJSON', () => {
    getRandomFeatureId.mockReturnValueOnce('1')

    return request(app.server)
      .post('/api/v2/convert/telepac-xml/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', 'test/fixtures/mesparcelles-export.xml')
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toMatchObject({
          type: 'FeatureCollection',
          features: [
            {
              id: '1',
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  expect.arrayContaining([[5.020622298258249, 44.73758401718037]])
                ]
              },
              properties: {
                id: '1',
                remoteId: '1.3',
                COMMUNE: '26108',
                NUMERO_I: '1',
                NUMERO_P: '3',
                PACAGE: '999000000',
                conversion_niveau: 'CONV',
                cultures: [
                  {
                    CPF: '01.13.42',
                    TYPE: 'AIL',
                    id: expect.stringMatching(UUIDRe)
                  }
                ]
              }
            }
          ]
        })
      })
  })

  test('it fails without auth', () => {
    return request(app.server)
      .post('/api/v2/convert/telepac-xml/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/telepac-dossier.xml')
      .then((response) => {
        expect(response.status).toEqual(401)
      })
  })
})

describe('POST /api/v2/convert/geofolia/geojson', () => {
  test('it converts a Geofolia zipped archive into WGS84 GeoJSON', () => {
    const expectation = JSON.parse(fs.readFileSync('test/fixtures/geofolia-parcelles.json', { encoding: 'utf8' }))
    getRandomFeatureId.mockReturnValueOnce('1').mockReturnValueOnce('2')

    return request(app.server)
      .post('/api/v2/convert/geofolia/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', 'test/fixtures/geofolia-parcelles.zip')
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toEqual(expectation)
      })
  })

  test('it fails without auth', () => {
    return request(app.server)
      .post('/api/v2/convert/geofolia/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/geofolia-parcelles.zip')
      .then((response) => {
        expect(response.status).toEqual(401)
      })
  })
})

describe('POST /api/v2/import/geofolia/:numeroBio', () => {
  const getMock = jest.mocked(got.get)
  const postMock = jest.mocked(got.post)
  const queryMock = jest.mocked(db.query)
  const archive = fs.readFileSync('test/fixtures/geofolia-parcelles.zip')
  const expectation = JSON.parse(fs.readFileSync('test/fixtures/geofolia-parcelles.json', { encoding: 'utf8' }))

  test('it checks the availability of a customer on Geofolink', () => {
    // setup operator
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: [] })

    // fake Geofolia token request
    postMock.mockReturnValueOnce({
      async json () {
        return { access_token: 'test-token' }
      }
    })

    postMock.mockReturnValueOnce({
      async json () {
        return []
      }
    })

    return request(app.server)
      .head('/api/v2/import/geofolia/1234')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(204)
      })
  })

  test('it did not find any relevant SIRET on Geofolink', () => {
    // setup operator
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: [] })

    // we skip the token as it is memoised
    postMock.mockReturnValueOnce({
      async json () {
        const response = { statusCode: 404, statusMessage: 'Not Found' }
        const error = new got.HTTPError(response)
        error.response = response
        throw error
      }
    })

    return request(app.server)
      .head('/api/v2/import/geofolia/1234')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(404)
      })
  })

  test('it requests a working archive on Geofolink', () => {
    getRandomFeatureId.mockReturnValueOnce('1').mockReturnValueOnce('2')

    // setup operator
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: [] })

    // we skip the token as it is memoised
    getMock.mockReturnValueOnce({
      async json () {
        return [{
          id: 'order-1',
          identificationCodes: ['999999999']
        }]
      }
    })

    getMock.mockReturnValueOnce({
      async buffer () {
        return archive
      }
    })

    return request(app.server)
      .get('/api/v2/import/geofolia/1234')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toEqual(expectation)
      })
  })

  test('it requests a working archive on Geofolink, but asks to come back later (because it is not ready yet)', () => {
    // setup operator
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: [] })

    // we skip the token as it is memoised
    getMock.mockReturnValueOnce({
      async json () {
        return []
      }
    })

    return request(app.server)
      .get('/api/v2/import/geofolia/1234')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(202)
      })
  })

  test('it fails without auth (head)', () => {
    return request(app.server)
      .head('/api/v2/import/geofolia/1234')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(401)
      })
  })

  test('it fails without auth (get)', () => {
    return request(app.server)
      .get('/api/v2/import/geofolia/1234')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(401)
      })
  })
})

describe('GET /api/v2/certification/operators/search', () => {
  const getMock = jest.mocked(got.get)
  const queryMock = jest.mocked(db.query)

  test('the input is recognized as a numero bio', async () => {
    getMock.mockReturnValueOnce({
      async json () {
        return [agencebioOperator]
      }
    })
    queryMock.mockResolvedValueOnce({ rows: [record] })

    return request(app.server)
      .post('/api/v2/certification/operators/search')
      .type('json')
      .send({ input: '1234' })
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
      })
  })

  test('otherwise it is seen as a farm name', () => {
    getMock.mockReturnValueOnce({
      async json () {
        return [agencebioOperator]
      }
    })
    queryMock.mockResolvedValueOnce({ rows: [record] })

    return request(app.server)
      .post('/api/v2/certification/operators/search')
      .send({ input: 'ferme 1234' })
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
      })
  })
})

describe('PATCH /api/v2/audits/:recordId/parcelles', () => {
  const fakeAbToken = 'abtoken-bbbb-cccc-dddd'
  const getMock = jest.mocked(got.get)
  const postMock = jest.mocked(got.post)
  const queryMock = jest.mocked(db.query)

  test('it updates only the patched properties of the features', async () => {
    clientQuery.mockClear()
    queryMock.mockReset()
    // 1. fetchAuthToken
    postMock.mockReturnValueOnce({
      async json () {
        return { token: fakeAbToken }
      }
    })

    // 2. enforceRecord + fetchOperatorById
    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: parcelles })
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    // 3. BEGIN
    clientQuery.mockResolvedValueOnce(null)
    // 4. UPDATE cartobio_operator
    clientQuery.mockResolvedValueOnce({ rows: [record] })
    // 5. UPDATE cartobio_parcelles
    for (let i = 0; i < 2; i++) {
      clientQuery.mockResolvedValueOnce({ rows: [parcellesPatched[i]] })
    }
    // joinRecordParcelles
    queryMock.mockResolvedValueOnce({ rows: parcellesPatched })

    const patchedRecordExpectation = normalizeRecord({
      ...record,
      parcelles: parcellesPatched
    })

    const response = await request(app.server)
      .patch('/api/v2/audits/054f0d70-c3da-448f-823e-81fcf7c2bf6e/parcelles')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .type('json')
      .send({
        type: 'FeatureCollection',
        features: [
          {
            id: 1,
            properties: {
              cultures: [
                {
                  id: '5910f110-96cb-4557-957c-fb77cae8695f',
                  CPF: '01.21.12'
                }
              ]
            }
          },
          {
            id: 2,
            properties: {
              cultures: [
                {
                  id: '5910f110-96cb-4557-957c-fb77cae8695f',
                  CPF: '01.21.12'
                }
              ]
            }
          }
        ]
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual(patchedRecordExpectation)
    expect(clientRelease).toHaveBeenCalled()
  })
})

describe('GET /api/v2/import/evv/:numeroEvv+:numeroBio', () => {
  const xmlEvv = fs.readFileSync(join(__dirname, 'lib', 'providers', '__fixtures__/cvi-evv.xml'), { encoding: 'utf8' })
  const xmlParcellaire = fs.readFileSync(join(__dirname, 'lib', 'providers', '__fixtures__/cvi-parcellaire.xml'), { encoding: 'utf8' })
  const getMock = jest.mocked(got.get).mockName('getMock')
  const queryMock = jest.mocked(db.query)

  beforeEach(() => {
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: [] })
  })

  test('it should return a feature collection', async () => {
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        return xmlEvv
      }
    })
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        return xmlParcellaire
      }
    })

    const res = await request(app.server)
      .get('/api/v2/import/evv/01234+99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('features.0.properties.cadastre', ['95476000AI0520'])
  })

  test('it should return a 404 with an unknown operator', async () => {
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        throw new got.HTTPError({ statusCode: 404 })
      }
    })

    const res = await request(app.server)
      .get('/api/v2/import/evv/01234+99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Ce numéro EVV est introuvable')
  })

  test('it should return a 404 with empty features', async () => {
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        return xmlEvv
      }
    })
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><parcellaire><listePcv></listePcv></parcellaire>'
      }
    })

    const res = await request(app.server)
      .get('/api/v2/import/evv/01234+99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Ce numéro EVV ne retourne pas de parcelles.')
  })

  test('it should return a 401 with a non-matching evv/siret', async () => {
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><evv><numero>01234</numero><siret>1111111111</siret><libelle>test viti</libelle></evv>'
      }
    })

    const res = await request(app.server)
      .get('/api/v2/import/evv/01234+99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch('ne correspondent pas')
  })

  test('it should return a 500 with an unavailable remote server', async () => {
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        throw new got.TimeoutError()
      }
    })

    const res = await request(app.server)
      .get('/api/v2/import/evv/01234+99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(500)
    expect(res.body.message).toMatch('Impossible de communiquer')
  })
})

describe('POST /api/v2/certification/parcelles', () => {
  const fakeOcToken = 'aaaa-bbbb-cccc-dddd'
  const postMock = jest.mocked(got.post)
  // 1. AUTHORIZATION check token
  postMock.mockReturnValue({
    async json () {
      return { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-999' }
    }
  })
  clientQuery.mockImplementation(
    async (sql, [, featureId, geometry] = []) => {
      if ((sql.includes('UPDATE cartobio_parcelles') && featureId === 124300) ||
        (sql.includes('INTO cartobio_parcelles') && !geometry)) {
        // Simulate trigger error
        const err = new Error('No geometry')
        err.code = '23502'
        throw err
      }

      return ({ rows: [record] })
    }
  )

  test('it fails without auth', async () => {
    const res = await request(app.server).post('/api/v2/certification/parcelles').send(apiParcellaire)
    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).not.toHaveBeenCalled()
    expect(res.status).toBe(401)
  })

  test('it responds with 400 when body is not valid JSON', async () => {
    const res = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send(apiParcellaire.toString() + ']')
    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).toHaveBeenCalled()
    expect(clientQuery).toHaveBeenLastCalledWith('ROLLBACK;')
    expect(clientRelease).toHaveBeenCalled()
    expect(res.status).toBe(400)
  })

  test('it responds with 400 when records are invalid and rollback modifications', async () => {
    const res = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send(apiParcellaire)
    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).toHaveBeenCalled()
    expect(clientQuery).toHaveBeenLastCalledWith('ROLLBACK;')
    expect(clientRelease).toHaveBeenCalled()
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      nbObjetTraites: 4,
      nbObjetAcceptes: 1,
      nbObjetRefuses: 3,
      listeProblemes: [
        // in case of error, check `createOrUpdateOperatorRecord()` SQL arity
        '[#2] champ dateAudit incorrect',
        '[#3] champ geom incorrect : Expected \',\' or \']\' after array element in JSON at position 32635',
        '[#4] La donnée géographique est manquante ou invalide.'
      ]
    })
  })

  test('it responds with 202 when records are valid and save everything to database', async () => {
    const validApiParcellaire = JSON.parse(JSON.stringify(apiParcellaire))
    validApiParcellaire.splice(1, 1)
    validApiParcellaire[1].parcelles[0].geom = '[[[0,0],[0,1],[1,1],[1,0],[0,0]]]'
    validApiParcellaire[2].parcelles[0].geom = '[[[0,0],[0,1],[1,1],[1,0],[0,0]]]'
    const res = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send(validApiParcellaire)

    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).toHaveBeenCalled()
    // BEGIN + 3 * BEGIN + 3 * COMMIT + 3 * INSERT cartobio_pperators
    // + 6 * INSERT cartobio_parcelles + 3 * DELETE + COMMIT
    expect(clientQuery).toHaveBeenCalledTimes(20)
    expect(clientQuery).toHaveBeenCalledWith('BEGIN;')
    expect(clientQuery).toHaveBeenNthCalledWith(2, 'BEGIN;')
    expect(clientQuery).toHaveBeenNthCalledWith(3, expect.stringContaining('cartobio_operators'), expect.anything())
    expect(clientQuery).toHaveBeenNthCalledWith(4, expect.stringContaining('cartobio_parcelles'), expect.anything())
    expect(clientQuery).toHaveBeenNthCalledWith(9, 'COMMIT;')
    expect(clientQuery).toHaveBeenLastCalledWith('COMMIT;')
    expect(clientRelease).toHaveBeenCalled()
    expect(res.status).toBe(202)
    expect(res.body).toEqual({
      nbObjetTraites: 3
    })
  })
})

describe('GET /api/v2/certification/parcellaire/:numeroBio', () => {
  test('it responds with 404 when no parcellaire is found', async () => {
    const queryMock = jest.mocked(db.query)
    queryMock.mockReset()
    queryMock.mockResolvedValueOnce({ rows: [] })

    const res = await request(app.server)
      .get('/api/v2/certification/parcellaire/1234')
      .set('Authorization', fakeOcToken)
    expect(res.status).toBe(404)
  })

  test('it responds with 200 when a parcellaire is found', async () => {
    const queryMock = jest.mocked(db.query)
    queryMock.mockReset()
    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: parcelles })

    const res = await request(app.server)
      .get('/api/v2/certification/parcellaire/1234')
      .set('Authorization', fakeOcToken)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(
      recordToApi(
        normalizeRecord({ parcelles, ...record })
      )
    )
  })
})
