const app = require('./server.js')
const { isHandledError } = require('./lib/errors')
const config = require('./lib/config.js')
const request = require('supertest')
const { createSigner } = require('fast-jwt')
const got = require('got')
const fs = require('node:fs')
const { join } = require('node:path')
const db = require('./lib/db.js')

const agencebioOperator = require('./lib/providers/__fixtures__/agence-bio-operateur.json')
const [, record] = require('./lib/providers/__fixtures__/records.json')
const parcelles = require('./lib/providers/__fixtures__/parcelles.json')
const records = require('./lib/providers/__fixtures__/records.json')
const parcellesPatched = require('./lib/providers/__fixtures__/parcelles-patched.json')
const apiParcellaire = require('./lib/providers/__fixtures__/agence-bio-api-parcellaire.json')
const { normalizeOperator } = require('./lib/outputs/operator.js')
const { normalizeRecord } = require('./lib/outputs/record')
const { surfaceForFeatureCollection, recordToApi, parcelleToApi } = require('./lib/outputs/api.js')
const { loadRecordFixture, expectDeepCloseTo } = require('./test/utils')

const sign = createSigner({ key: config.get('jwtSecret') })

const fakeOcToken = 'aaaa-bbbb-cccc-dddd'
const fakeOc = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }
const fakeUser = { id: 1, prenom: 'Tonio', nom: 'Est', test: true, organismeCertificateur: fakeOc }
const USER_DOC_AUTH_TOKEN = sign(fakeUser)
const USER_DOC_AUTH_HEADER = `Bearer ${USER_DOC_AUTH_TOKEN}`

const otherFakeOc = { id: 1111, nom: 'Certificator', numeroControleEu: 'FR-BIO-1111' }
const OTHER_USER_DOC_AUTH_TOKEN = sign({ id: 2, prenom: 'Tania', nom: 'Ouest', test: true, organismeCertificateur: otherFakeOc })
const OTHER_OC_AUTH_TOKEN = 'zzzz-zzzz-zzzz-zzzz'

const mockSentry = jest.fn()
let apiRecordExpect
// start and stop server
beforeAll(async () => {
  const returnRecordToApi = await recordToApi(
    normalizeRecord({ parcelles, ...record })
  )
  apiRecordExpect = expectDeepCloseTo(returnRecordToApi)
  apiRecordExpect.parcellaire.features.forEach(f => delete f.properties.dateAjout)

  app.addHook('onError', async (req, res, error) => {
    if (isHandledError(error)) {
      return
    }

    mockSentry(error)
  })
  return app.ready()
})
afterAll(() => app.close())
afterEach(() => jest.clearAllMocks())

describe('GET /', () => {
  test('responds with a 404', () => {
    return request(app.server)
      .get('/')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(404)
        expect(mockSentry).not.toHaveBeenCalled()
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
  test('responds with cartobio decoded token Authorization', () => {
    return request(app.server)
      .get('/api/v2/user/verify')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toMatchObject(fakeUser)
      })
  })

  test('responds well with an access_token query string value', () => {
    return request(app.server)
      .get('/api/v2/user/verify')
      .query({ access_token: USER_DOC_AUTH_TOKEN })
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toMatchObject(fakeUser)
      })
  })

  test('responds with an OC token Authorization', () => {
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
        expect(response.status).toEqual(200)
        expect(response.body).toMatchObject(fakeOc)
      })
  })

  test('handle AgenceBio upstream errors', async () => {
    const postMock = jest.mocked(got.post)
    postMock.mockReturnValueOnce({
      async json () {
        throw new got.HTTPError({ statusCode: 500 })
      }
    })
    const response = await request(app.server)
      .get('/api/v2/user/verify')
      .set('Authorization', fakeOcToken)
      .type('json')

    expect(response.status).toEqual(502)
    expect(mockSentry).toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Bad Gateway',
      message: 'Erreur serveur : Le portail d\'authentification de l\'Agence Bio n\'a pas pu être contacté.'
    })
  })
})

describe('GET /api/v2/test', () => {
  test('fails when JWT is missing, or invalid', async () => {
    const response = await request(app.server)
      .get('/api/v2/test')
      .type('json')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.header['content-type']).toBe('application/json; charset=utf-8')
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
    })
  })

  test('fails when JWT cannot be verified', async () => {
    const sign = createSigner({ key: 'aaaaa' })
    const wrongUserToken = sign(fakeUser)

    const response = await request(app.server)
      .get('/api/v2/test')
      .type('json')
      .set('Authorization', `Bearer ${wrongUserToken}`)

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.header['content-type']).toBe('application/json; charset=utf-8')
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : ce jeton n'est plus valide (FAST_JWT_INVALID_SIGNATURE)."
    })
  })

  test('responds well with an Authorization header', async () => {
    const response = await request(app.server)
      .get('/api/v2/test')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(response.status).toEqual(200)
    expect(response.header['content-type']).toBe('application/json; charset=utf-8')
    expect(response.body).toEqual({ message: 'OK' })
  })

  test('responds well with an access_token query string value', async () => {
    const response = await request(app.server)
      .get('/api/v2/test')
      .query({ access_token: USER_DOC_AUTH_TOKEN })
      .type('json')

    expect(response.status).toEqual(200)
  })
})

describe('GET /api/v2/certification/parcellaire/:numeroBio', () => {
  const postMock = jest.mocked(got.post)
  const getMock = jest.mocked(got.get)

  beforeEach(loadRecordFixture)
  afterEach(() => {
    postMock.mockReset()
    getMock.mockReset()
  })

  test('it responds with 404 when no operator is found on AgenceBio API', async () => {
    getMock.mockReturnValueOnce({
      async json () {
        const response = { statusCode: 404, statusMessage: 'Not Found' }
        const error = new got.HTTPError(response)
        error.response = response
        throw error
      }
    })

    const res = await request(app.server)
      .get('/api/v2/certification/parcellaire/1234')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(404)
    expect(mockSentry).not.toHaveBeenCalled()
  })

  test('it responds with 200 when a parcellaire is found', async () => {
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    const res = await request(app.server)
      .get('/api/v2/certification/parcellaire/99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject(apiRecordExpect)
  })

  test('it works with an oc token', async () => {
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })

    const response = await request(app.server)
      .get('/api/v2/certification/parcellaire/99999')
      .set('Authorization', fakeOcToken)
      .type('json')

    expect(response.status).toEqual(200)
    expect(response.body).toMatchObject(apiRecordExpect)
  })

  test('it fails with a non-matching user token', async () => {
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    const response = await request(app.server)
      .get('/api/v2/certification/parcellaire/99999')
      .set('Authorization', `Bearer ${OTHER_USER_DOC_AUTH_TOKEN}`)
      .type('json')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants."
    })
  })

  test('it fails with a non-matching oc token', async () => {
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    postMock.mockReturnValueOnce({
      async json () {
        return otherFakeOc
      }
    })

    const response = await request(app.server)
      .get('/api/v2/certification/parcellaire/99999')
      .set('Authorization', OTHER_OC_AUTH_TOKEN)
      .type('json')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants."
    })
  })
})

describe('GET /api/v2/audits/:recordId', () => {
  beforeEach(loadRecordFixture)

  test('it works with a matching user token', async () => {
    got.get.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    const response = await request(app.server)
      .get('/api/v2/audits/054f0d70-c3da-448f-823e-81fcf7c11112')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .type('json')

    const expectedRecord = normalizeRecord({ parcelles, ...record })

    // we cleanup fixtures stuff
    delete expectedRecord.oc_id
    delete expectedRecord.oc_label
    expectedRecord.parcelles.features.forEach(
      f => delete f.properties.createdAt
    )

    expect(response.status).toEqual(200)
    expect(response.body).toMatchObject(expectDeepCloseTo(expectedRecord))
  })

  test('it is not supposed to work with a valid oc token', async () => {
    got.get.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    got.post.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })

    const response = await request(app.server)
      .get('/api/v2/audits/054f0d70-c3da-448f-823e-81fcf7c11112')
      .set('Authorization', fakeOcToken)
      .type('json')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
    })
  })

  test('it fails with an inexisting record', async () => {
    got.get.mockReturnValueOnce({
      async json () {
        const response = { statusCode: 404, statusMessage: 'Not Found' }
        const error = new got.HTTPError(response)
        error.response = response
        throw error
      }
    })

    const res = await request(app.server)
      .get('/api/v2/audits/aaaaaaaa-c3da-448f-823e-81fcf7c2bf6e')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(404)
  })

  test('it fails with a non-matching user token', async () => {
    const response = await request(app.server)
      .get('/api/v2/audits/054f0d70-c3da-448f-823e-81fcf7c11112')
      .set('Authorization', `Bearer ${OTHER_USER_DOC_AUTH_TOKEN}`)
      .type('json')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants."
    })
  })
})

describe('POST /api/v2/convert/telepac/geojson', () => {
  const { single, multi } = require('./test/fixtures/telepac-expectations.js')

  test('it converts a L93 zipped archive into WGS84 GeoJSON', () => {
    return request(app.server)
      .post('/api/v2/convert/telepac/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', 'test/fixtures/telepac-parcelles.zip')
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body.features).toHaveLength(45)
        expect(response.body).toHaveProperty('features.0.type', 'Feature')
      })
  })

  test.each(['telepac-multi-2024v4.xml', 'telepac-multi-2024v3.xml'])('it converts a L93 multi-feature XML %s to WGS84 GeoJSON', (filename) => {
    return request(app.server)
      .post('/api/v2/convert/telepac/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', `test/fixtures/${filename}`)
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toMatchObject(multi)
      })
  })

  test.each(['telepac-single-2024v3.xml', 'telepac-single-2024v4.xml'])('it converts a L93 single-feature XML %s to WGS84 GeoJSON', (filename) => {
    return request(app.server)
      .post('/api/v2/convert/telepac/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', `test/fixtures/${filename}`)
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toMatchObject(single)
      })
  })

  test('it fails when sending a non-recognized file', async () => {
    const response = await request(app.server)
      .post('/api/v2/convert/telepac/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', 'test/fixtures/parcels.json')

    expect(response.status).toEqual(400)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Format de fichier non-reconnu.'
    })
  })

  test.each(['geofolia-parcelles.zip', 'anygeo/anygeo-test.zip'])('it fails when sending a non-recognized format (%s)', async (filepath) => {
    const response = await request(app.server)
      .post('/api/v2/convert/telepac/geojson')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .attach('archive', `test/fixtures/${filepath}`)

    expect(response.status).toEqual(400)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Il ne s\'agit pas d\'un fichier Telepac "Parcelles déclarées" ou "Parcelles instruites".'
    })
  })

  test('it fails without auth', async () => {
    const response = await request(app.server)
      .post('/api/v2/convert/telepac/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/telepac-multi-2024v4.xml')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
    })
  })
})

describe('POST /api/v2/convert/geofolia/geojson', () => {
  test('it converts a Geofolia zipped archive into WGS84 GeoJSON', () => {
    const expectation = require('./test/fixtures/geofolia-parcelles.js')

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

  test('it fails without auth', async () => {
    const response = await request(app.server)
      .post('/api/v2/convert/geofolia/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/geofolia-parcelles.zip')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
    })
  })
})

describe('HEAD/GET /api/v2/import/geofolia/:numeroBio', () => {
  const getMock = jest.mocked(got.get)
  const postMock = jest.mocked(got.post)
  const archive = fs.readFileSync('test/fixtures/geofolia-parcelles.zip')
  const expectation = require('./test/fixtures/geofolia-parcelles.js')

  describe('HEAD /api/v2/import/geofolia/:numeroBio', () => {
    beforeEach(loadRecordFixture)
    afterEach(() => {
      getMock.mockReset()
      postMock.mockReset()
    })
    beforeAll(() => {
      getMock.mockReset()
      postMock.mockReset()
    })

    test('it fails without auth (head)', async () => {
      const response = await request(app.server)
        .head('/api/v2/import/geofolia/99999')
        .type('json')

      expect(response.status).toEqual(401)
      expect(mockSentry).not.toHaveBeenCalled()
    })

    test('it should return a 502 with unavailable remote server', async () => {
      // setup operator
      getMock.mockReturnValueOnce({
        async json () {
          return agencebioOperator
        }
      })

      // fake Geofolia token request
      postMock.mockReturnValueOnce({
        async json () {
          return { access_token: 'test-token' }
        }
      })

      // fail reaching Geofolia
      postMock.mockReturnValueOnce({
        async json () {
          throw new got.HTTPError({
            statusCode: 500
          })
        }
      })

      const response = await request(app.server)
        .head('/api/v2/import/geofolia/99999')
        .type('json')
        .set('Authorization', USER_DOC_AUTH_HEADER)

      expect(response.status).toEqual(502)
      expect(mockSentry).toHaveBeenCalled()
    })

    test('it checks the availability of a customer on Geofolink', () => {
      // setup operator
      getMock.mockReturnValueOnce({
        async json () {
          return agencebioOperator
        }
      })

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
        .head('/api/v2/import/geofolia/99999')
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
        .head('/api/v2/import/geofolia/99999')
        .type('json')
        .set('Authorization', USER_DOC_AUTH_HEADER)
        .then((response) => {
          expect(response.status).toEqual(404)
        })
    })
  })

  describe('GET /api/v2/import/geofolia/:numeroBio', () => {
    beforeEach(loadRecordFixture)
    afterEach(() => {
      getMock.mockReset()
      postMock.mockReset()
    })
    beforeAll(() => {
      getMock.mockReset()
      postMock.mockReset()
    })

    test('it fails without auth (get)', async () => {
      const response = await request(app.server)
        .get('/api/v2/import/geofolia/99999')
        .type('json')

      expect(response.status).toEqual(401)
      expect(mockSentry).not.toHaveBeenCalled()
      expect(response.body).toMatchObject({
        error: 'Unauthorized',
        message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
      })
    })

    test('it requests a working archive on Geofolink', () => {
      // setup operator
      getMock.mockReturnValueOnce({
        async json () {
          return agencebioOperator
        }
      })

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
        .get('/api/v2/import/geofolia/99999')
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

      // we skip the token as it is memoised
      getMock.mockReturnValueOnce({
        async json () {
          return []
        }
      })

      return request(app.server)
        .get('/api/v2/import/geofolia/99999')
        .type('json')
        .set('Authorization', USER_DOC_AUTH_HEADER)
        .then((response) => {
          expect(response.status).toEqual(202)
        })
    })
  })
})

describe('POST /api/v2/convert/anygeo/geojson', () => {
  test('it fails without auth (get)', async () => {
    const response = await request(app.server)
      .post('/api/v2/convert/anygeo/geojson')
      .type('json')

    expect(response.status).toEqual(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
    })
  })

  test.each(['anygeo-test.kml', 'anygeo-test.geojson', 'anygeo-test.gpkg', 'anygeo-test.gpkg.zip', 'anygeo-test.kmz', 'anygeo-test.zip'])('it responds to %s with 2 features', (filename) => {
    return request(app.server)
      .post('/api/v2/convert/anygeo/geojson')
      .attach('archive', `test/fixtures/anygeo/${filename}`)
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then(async (response) => {
        expect(response.status).toEqual(200)
        console.log(response.body)
        expect(await surfaceForFeatureCollection(response.body)).toBeCloseTo(456681.77564219804 + 390972.0511883315, 1)
        expect(response.body.features).toHaveLength(2)
        expect(response.body.features.at(0)).toHaveProperty('properties', {
          id: expect.toBeAFeatureId()
        })
      })
  })

  test('it responds to anygeo-test-cartobio.json with 2 features and their properties', async () => {
    return request(app.server)
      .post('/api/v2/convert/anygeo/geojson')
      .attach('archive', 'test/fixtures/anygeo/anygeo-test-cartobio.json')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then(async (response) => {
        expect(response.status).toEqual(200)
        expect(await surfaceForFeatureCollection(response.body)).toBeCloseTo(456681.77564219804 + 390972.0511883315, 1)
        expect(response.body.features).toHaveLength(2)
        expect(response.body.features.at(0)).toHaveProperty('properties', {
          id: expect.toBeAFeatureId(),
          COMMUNE: '89118',
          COMMUNE_LABEL: null,
          NOM: 'ilôt 22 - Coulanges-la-Vineuse / Jachère Côte de Groix Milieu',
          PACAGE: null,
          annotations: [],
          auditeur_notes: null,
          cadastre: [
            '70421000ZP0072'
          ],
          commentaires: null,
          conversion_niveau: 'CONV',
          cultures: [
            {
              CPF: '01.91',
              id: '257665e8-91ff-4cb1-b606-a1f4c0d1e8f3',
              surface: '1.17'
            }
          ]
        })
        expect(response.body.features.at(1)).toHaveProperty('properties', {
          id: expect.toBeAFeatureId(),
          COMMUNE: '89118',
          COMMUNE_LABEL: 'Coulanges-la-Vineuse',
          NOM: 'Coulanges-la-vineuse Montfaucon (Moussu) / AOP Bourgogne Coulanges la vineuse Rouge',
          NUMERO_I: 19,
          NUMERO_P: 1,
          PACAGE: '089156290',
          annotations: [
            {
              code: 'surveyed',
              date: '2024-04-23T07:56:23.315Z',
              id: '40be59a3-6749-49c4-bb11-1e7b5767779f'
            }
          ],
          auditeur_notes: null,
          cadastre: null,
          commentaires: null,
          conversion_niveau: 'AB',
          cultures: [
            {
              CPF: '01.21.12',
              TYPE: 'VRC',
              id: '72ac54ce-3c22-47b8-9093-f64983bea580',
              surface: '0.3',
              variete: 'Pinot Noir'
            }
          ],
          engagement_date: '2019-12-20'
        })
      })
  })

  test.each(['geofolia-parcelles.zip', '../../package.json', 'anygeo/anygeo-test.xlsx'])('it fails with non-anygeo file %s', async (filepath) => {
    const response = await request(app.server)
      .post('/api/v2/convert/anygeo/geojson')
      .attach('archive', `test/fixtures/${filepath}`)
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(response.status).toEqual(400)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(response.body).toMatchObject({
      error: 'Bad Request',
      message: 'Format de fichier non-reconnu.'
    })
  })
})

describe('GET /api/v2/certification/search', () => {
  const getMock = jest.mocked(got.get)

  const mockResultsOrder = (...results) => {
    results.forEach(result => {
      getMock.mockReturnValueOnce({
        async json () {
          return result
        }
      })
    })
  }

  describe('with search', () => {
    beforeEach(loadRecordFixture)
    beforeEach(() => mockResultsOrder({ nbTotal: 1, operateurs: [{ ...agencebioOperator, siret: '12345678912345' }] }))
    afterEach(() => getMock.mockReset())

    test('search numero bio', async () => {
      return request(app.server)
        .post('/api/v2/certification/search')
        .type('json')
        .send({ input: '99999' })
        .set('Authorization', USER_DOC_AUTH_HEADER)
        .then((response) => {
          expect(response.body).toMatchObject({
            pagination: {
              total: 1,
              page: 1,
              page_max: 1
            },
            records: [
              {
                ...normalizeOperator({ ...agencebioOperator, siret: '12345678912345' }),
                dateEngagement: '',
                datePremierEngagement: null,
                record_id: '054f0d70-c3da-448f-823e-81fcf7c2bf6e',
                certification_state: 'PENDING_CERTIFICATION',
                audit_date: '2023-09-07'
              }
            ]
          })
        })
    })

    test('search nom', () => {
      return request(app.server)
        .post('/api/v2/certification/search')
        .type('json')
        .send({ input: 'test' })
        .set('Authorization', USER_DOC_AUTH_HEADER)
        .then((response) => {
          expect(response.body).toMatchObject({
            pagination: {
              total: 1,
              page: 1,
              page_max: 1
            },
            records: [
              {
                ...normalizeOperator({ ...agencebioOperator, siret: '12345678912345' }),
                dateEngagement: '',
                datePremierEngagement: null,
                record_id: '054f0d70-c3da-448f-823e-81fcf7c2bf6e',
                certification_state: 'PENDING_CERTIFICATION',
                audit_date: '2023-09-07'
              }
            ]
          })
        })
    })

    test('search siret', () => {
      return request(app.server)
        .post('/api/v2/certification/search')
        .type('json')
        .send({ input: '12345678912345' })
        .set('Authorization', USER_DOC_AUTH_HEADER)
        .then((response) => {
          expect(response.body).toMatchObject({
            pagination: {
              total: 1,
              page: 1,
              page_max: 1
            },
            records: [
              {
                ...normalizeOperator({ ...agencebioOperator, siret: '12345678912345' }),
                dateEngagement: '',
                datePremierEngagement: null,
                record_id: '054f0d70-c3da-448f-823e-81fcf7c2bf6e',
                certification_state: 'PENDING_CERTIFICATION',
                audit_date: '2023-09-07'
              }
            ]
          })
        })
    })
  })
})

describe('PATCH /api/v2/audits/:recordId/parcelles', () => {
  const fakeAbToken = 'abtoken-bbbb-cccc-dddd'
  const getMock = jest.mocked(got.get)
  const postMock = jest.mocked(got.post)

  beforeEach(async () => {
    await loadRecordFixture()
    // 1. fetchAuthToken
    postMock.mockReturnValueOnce({
      async json () {
        return { token: fakeAbToken }
      }
    })

    // 2. enforceRecord + fetchOperatorById
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })
  })

  afterEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  test('it updates only the patched properties of the features', async () => {
    const patchedRecordExpectation = normalizeRecord({
      ...record,
      parcelles: parcellesPatched
    })
    patchedRecordExpectation.parcelles.features.forEach(
      parcelle => {
        delete parcelle.properties.updatedAt
        delete parcelle.properties.createdAt
      }
    ) // we don't know

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
    expect(response.body.audit_history).toHaveLength(2)
    expect(db._clientRelease).toHaveBeenCalled()
    expect(response.body.parcelles).toMatchObject(expectDeepCloseTo(patchedRecordExpectation.parcelles))
  })

  test('it fails if if-unmodified-since does not match', async () => {
    const updatedDiff = (new Date()).getTime() - 1000 * 60 * 5 // there should be less than 5 minutes since fixture loading
    const ifModifiedSince = (new Date(updatedDiff)).toUTCString()
    const response = await request(app.server)
      .patch('/api/v2/audits/054f0d70-c3da-448f-823e-81fcf7c2bf6e/parcelles')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .set('If-Unmodified-Since', ifModifiedSince)
      .send({
        type: 'FeatureCollection',
        features: []
      })

    expect(response.status).toBe(412)
  })

  test('it works if if-unmodified-since matches', async () => {
    const updatedDiff = (new Date()).getTime() + 1000 * 60 * 5 // there should be less than 5 minutes since fixture loading
    const ifModifiedSince = (new Date(updatedDiff)).toUTCString()
    const response = await request(app.server)
      .patch('/api/v2/audits/054f0d70-c3da-448f-823e-81fcf7c2bf6e/parcelles')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .set('If-Unmodified-Since', ifModifiedSince)
      .send({
        type: 'FeatureCollection',
        features: []
      })

    expect(response.status).toBe(200)
  })
})

describe('GET /api/v2/import/evv/:numeroEvv+:numeroBio', () => {
  const xmlEvv = fs.readFileSync(join(__dirname, 'lib', 'providers', '__fixtures__/cvi-evv.xml'), { encoding: 'utf8' })
  const xmlParcellaire = fs.readFileSync(join(__dirname, 'lib', 'providers', '__fixtures__/cvi-parcellaire.xml'), { encoding: 'utf8' })

  beforeEach(() => {
    got.get.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })
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
        const response = { statusCode: 404, statusMessage: 'Not Found' }
        const error = new got.HTTPError(response)
        error.response = response
        throw error
      }
    })

    const res = await request(app.server)
      .get('/api/v2/import/evv/01234+99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({
      error: 'Not Found',
      message: 'Ce numéro EVV est introuvable'
    })
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
    expect(res.body).toMatchObject({
      error: 'Not Found',
      message: 'Ce numéro EVV ne retourne pas de parcelles.'
    })
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
    expect(mockSentry).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : les numéros SIRET du nCVI et de l'opérateur Agence Bio ne correspondent pas."
    })
  })

  test('it should return a 502 with an unavailable remote server', async () => {
    got.__mocks.get.mockReturnValueOnce({
      async text () {
        throw new got.TimeoutError()
      }
    })

    const res = await request(app.server)
      .get('/api/v2/import/evv/01234+99999')
      .set('Authorization', USER_DOC_AUTH_HEADER)

    expect(res.status).toBe(502)
    expect(mockSentry).toHaveBeenCalled()
    expect(res.body.message).toMatch('Impossible de communiquer avec l\'API CVI')
  })
})

describe('GET /api/v2/certification/parcellaires', () => {
  const postMock = jest.mocked(got.post)
  let expectedResult
  beforeEach(async () => {
    expectedResult = await records.reverse().reduce(async (accPromise, record) => {
      const acc = await accPromise

      const normalizedRecord = normalizeRecord({ parcelles, ...record })
      const apiRecord = await recordToApi(normalizedRecord)
      const expectedRecord = expectDeepCloseTo(apiRecord)
      expectedRecord.parcellaire.features.forEach(f => delete f.properties.dateAjout)
      if (acc.find(r => r.numeroBio === expectedRecord.numeroBio)) {
        return acc
      } else {
        acc.push(expectedRecord)
        return acc
      }
    }, Promise.resolve([]))
    // 1. AUTHORIZATION check token
    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })
    await loadRecordFixture()
  })
  afterEach(() => postMock.mockReset())

  test('it should return a list of parcellaire', async () => {
    const res = await request(app.server)
      .get('/api/v2/certification/parcellaires')
      .set('Authorization', fakeOcToken)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(expectedResult.length)
    expect(res.body).toMatchObject(expectedResult)
  })

  test('we can filter on status', async () => {
    const res = await request(app.server)
      .get('/api/v2/certification/parcellaires?statut=CERTIFIED')
      .set('Authorization', fakeOcToken)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  test('we can filter on year', async () => {
    const res = await request(app.server)
      .get('/api/v2/certification/parcellaires?anneeAudit=2023')
      .set('Authorization', fakeOcToken)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  test('it should only return this oc\'s parcellaire', async () => {
    await db.query(`
      UPDATE cartobio_operators SET oc_id = '1' WHERE numerobio = '99999';
    `)
    const res = await request(app.server)
      .get('/api/v2/certification/parcellaires')
      .set('Authorization', OTHER_OC_AUTH_TOKEN)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(expectedResult.length - 1)
  })

  test('it should return a 401 without auth', async () => {
    const res = await request(app.server)
      .get('/api/v2/certification/parcellaires')

    expect(res.status).toBe(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
    })
  })
})

describe('POST /api/v2/certification/parcelles', () => {
  const postMock = jest.mocked(got.post)

  beforeEach(() => {
    // 1. AUTHORIZATION check token
    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })
  })
  afterEach(() => postMock.mockReset())

  test('it fails without auth', async () => {
    const res = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .send(apiParcellaire)

    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).not.toHaveBeenCalled()
    expect(res.status).toBe(401)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({
      error: 'Unauthorized',
      message: "Accès refusé : un jeton d'API est nécessaire pour accéder à ce contenu."
    })
  })

  test('it responds with 400 when body is not valid JSON', async () => {
    const res = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send(apiParcellaire.toString() + ']')

    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).toHaveBeenCalled()
    expect(db._clientQuery).toHaveBeenCalledWith('ROLLBACK;')
    expect(db._clientRelease).toHaveBeenCalled()
    expect(mockSentry).not.toHaveBeenCalled()
    expect(res.status).toBe(400)
  })

  test('it responds with 400 when records are invalid and rollback modifications', async () => {
    const res = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send(apiParcellaire)
    /** TMP */
    // expect(db.query).toHaveBeenCalled()
    // expect(db.connect).toHaveBeenCalled()
    // expect(db._clientRelease).toHaveBeenCalled()
    expect(res.status).toBe(400)
    expect(mockSentry).not.toHaveBeenCalled()
    expect(res.body).toEqual({
      nbObjetAcceptes: 2,
      nbObjetRefuses: 7,
      nbObjetTraites: 9,
      listeProblemes: [
        // in case of error, check `createOrUpdateOperatorRecord()` SQL arity
        '[#1] Impossible de créer une parcelle sans donnée géographique.',
        '[#2] champ dateAudit incorrect',
        '[#3] champ geom incorrect : Expected \',\' or \']\' after array element in JSON at position 32635',
        '[#6] Impossible de créer une parcelle sans donnée géographique.',
        '[#7] Les dates de certification sont manquantes.',
        '[#8] champ etatProduction incorrect',
        '[#9] Champ date dengagement obligatoire lorsque que la parcelle est en conversion'
      ],
      listeWarning: []
    })
  })

  test('it responds with 202 when records are valid and save everything to database', async () => {
    const validApiParcellaire = JSON.parse(JSON.stringify(apiParcellaire))
    validApiParcellaire[0].parcelles.splice(1, 3)
    validApiParcellaire.splice(3, 2)
    validApiParcellaire.splice(1, 1)
    validApiParcellaire[1].parcelles[0].geom = '[[[-61.04349055792852,14.723261389183236],[-61.043394367539705,14.72324278279335],[-61.04332156461696,14.72331866766676],[-61.043473960371315,14.723338733374248],[-61.04349055792852,14.723261389183236]]]'
    validApiParcellaire[2].parcelles[0].geom = validApiParcellaire[1].parcelles[0].geom
    validApiParcellaire[3].dateCertificationDebut = '2023-01-01'
    validApiParcellaire[3].dateCertificationFin = '2024-01-01'
    validApiParcellaire[4].parcelles[0].etatProduction = 'AB'
    validApiParcellaire[5].parcelles[0].dateEngagement = '2024-01-01'
    const res = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send(validApiParcellaire)

    /** TMP */
    // expect(db.query).toHaveBeenCalled()
    // expect(db.connect).toHaveBeenCalled()
    // expect(db._clientQuery).toHaveBeenLastCalledWith('COMMIT;')
    // expect(db._clientRelease).toHaveBeenCalled()
    expect(res.status).toBe(202)
    expect(res.body).toEqual({
      nbObjetTraites: 6,
      listeWarning: []
    })
  }, 10000)

  test('it stores well all the data', async () => {
    const validApiParcellaire = JSON.parse(JSON.stringify(apiParcellaire))
    validApiParcellaire[0].parcelles.splice(1, 3)
    const d = validApiParcellaire.at(0)
    d.parcelles.at(0).geom = '[[[-61.04349055792852,14.723261389183236],[-61.043394367539705,14.72324278279335],[-61.04332156461696,14.72331866766676],[-61.043473960371315,14.723338733374248],[-61.04349055792852,14.723261389183236]]]'

    let response = await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send([d])

    expect(response.status).toBe(202)
    expect(response.body).toEqual({
      nbObjetTraites: 1,
      listeWarning: []
    })

    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })

    got.get.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    response = await request(app.server)
      .get('/api/v2/certification/parcellaire/99999')
      .set('Authorization', fakeOcToken)

    expect(response.body).toMatchObject({
      numeroBio: d.numeroBio,
      certification: {
        statut: 'CERTIFIED',
        dateAudit: d.dateAudit,
        dateDebut: d.dateCertificationDebut,
        dateFin: d.dateCertificationFin,
        demandesAudit: '',
        notesAudit: d.commentaire
      }
    })

    expect(response.body.parcellaire.features.find(f => f.id === '45742')).toMatchObject(
      await parcelleToApi({
        id: '45742',
        geometry: {
          type: 'Polygon',
          coordinates: JSON.parse('[[[-61.043490558,14.723261389],[-61.043394368,14.723242783],[-61.043321565,14.723318668],[-61.04347396,14.723338733],[-61.043490558,14.723261389]]]')
        },
        properties: {
          id: '45742',
          COMMUNE: '97212',
          cultures: [
            {
              CPF: '01.92',
              date_semis: '2023-10-10',
              surface: 25,
              unit: '%',
              variete: ''
            }
          ],
          conversion_niveau: 'AB',
          engagement_date: '2023-04-27',
          auditeur_notes: 'Parcelle 5 ILOT 12 PAC 2023 0C 1271',
          annotations: [],
          createdAt: expect.stringMatchingISODate(),
          updatedAt: expect.stringMatchingISODate(),
          NOM: null,
          PACAGE: d.numeroPacage,
          NUMERO_I: '12',
          NUMERO_P: '5'
        }
      })
    )
  })

  test('it maintains the value of optional fields', async () => {
    await loadRecordFixture()

    const payload = {
      dateAudit: '2022-05-01',
      numeroBio: '99999',
      dateCertificationDebut: null,
      dateCertificationFin: null,
      commentaire: null,
      parcelles: [
        {
          id: '1',
          geom: null,
          cultures: [{ codeCPF: '01.19.10.8' }],
          commentaire: null,
          dateEngagement: null,
          etatProduction: null
        }
      ]
    }

    await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send([payload])

    const { rows } = await db.query('SELECT * FROM cartobio_operators WHERE numerobio = $1 AND audit_date = $2', ['99999', '2022-05-01'])
    expect(rows).toHaveLength(1)
    expect(rows[0].certification_date_debut).toBe('2022-01-01')
    expect(rows[0].certification_date_fin).toBe('2024-03-31')
    expect(rows[0].audit_notes).toBe('notes 2022')

    const { rows: parcelles } = await db.query('SELECT * FROM cartobio_parcelles WHERE record_id = $1', [rows[0].record_id])
    expect(parcelles).toHaveLength(1)
    expect(parcelles[0].cultures).toHaveLength(1)
    expect(parcelles[0].cultures[0].CPF).toBe('01.19.10.8')
    expect(parcelles[0].commune).toBe('26108')
    expect(parcelles[0].conversion_niveau).toBe('AB')
    expect(parcelles[0].engagement_date).toBe('2015-01-01')
  })

  test('it deletes fields value', async () => {
    await loadRecordFixture()

    const payload = {
      dateAudit: '2022-05-01',
      numeroBio: '99999',
      commentaire: '',
      parcelles: [
        {
          id: '1',
          geom: null,
          cultures: [{ codeCPF: '01.19.10.8' }],
          commentaire: '',
          dateEngagement: '',
          etatProduction: ''
        }
      ]
    }

    await request(app.server)
      .post('/api/v2/certification/parcelles')
      .set('Authorization', fakeOcToken)
      .send([payload])

    const { rows } = await db.query('SELECT * FROM cartobio_operators WHERE numerobio = $1 AND audit_date = $2', ['99999', '2022-05-01'])
    expect(rows).toHaveLength(1)
    expect(rows[0].audit_notes).toBe('')

    const { rows: parcelles } = await db.query('SELECT * FROM cartobio_parcelles WHERE record_id = $1', [rows[0].record_id])
    expect(parcelles).toHaveLength(1)
    expect(parcelles[0].cultures).toHaveLength(1)
    expect(parcelles[0].cultures[0].CPF).toBe('01.19.10.8')
    expect(parcelles[0].commune).toBe('26108')
    expect(parcelles[0].conversion_niveau).toBe('')
    expect(parcelles[0].engagement_date).toBeNull()
  })
})

describe('GET /api/v2/operators', () => {
  const getMock = jest.mocked(got.get)

  afterEach(() => {
    getMock.mockReset()
  })

  test('it returns the correct list of operators for a given user', async () => {
    getMock.mockReturnValueOnce({
      async json () {
        return Array(5).fill(agencebioOperator)
      }
    })

    const response = await request(app.server)
      .get('/api/v2/operators')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .query({ limit: 5, offset: 0 })

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('nbTotal', 5)
    expect(response.body).toHaveProperty('operators')
    expect(response.body.operators).toHaveLength(5)
    expect(response.body.operators[0]).toMatchObject(normalizeOperator(agencebioOperator))
  })
})
