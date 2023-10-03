const { server: app, close, ready } = require('./server')
const config = require('./lib/config.js')
const request = require('supertest')
const { createSigner } = require('fast-jwt')
const got = require('got')
const db = require('./lib/db.js')

const agencebioOperator = require('./lib/providers/__fixtures__/agence-bio-operateur.json')
const record = require('./lib/providers/__fixtures__/record-with-features.json')
const patchedRecordExpectation = require('./lib/providers/__fixtures__/record-with-features-patched.json')

const sign = createSigner({ key: config.get('jwtSecret') })
const USER_DOC_AUTH_TOKEN = sign({ ocId: 0, test: true })
const USER_DOC_AUTH_HEADER = `Bearer ${USER_DOC_AUTH_TOKEN}`

const fakeOcToken = 'aaaa-bbbb-cccc-dddd'
const fakeOc = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }

// start and stop server
beforeAll(() => ready())
afterAll(() => close())
afterEach(() => jest.clearAllMocks())

jest.mock('got', () => ({
  get: jest.fn(),
  post: jest.fn()
}))

jest.mock('./lib/db.js', () => ({
  query: jest.fn()
}))

describe('GET /', () => {
  test('responds with a 404', () => {
    return request(app)
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
    return request(app)
      .get('/api/version')
      .type('json')
      .then((response) => {
        expect(response.body).toHaveProperty('version', config.get('version'))
      })
  })

  test('responds with not found', () => {
    return request(app)
      .get('/api/v1/version')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(404)
      })
  })
})

describe('GET /api/v2/user/verify', () => {
  test('responds with cartobio decoded token', () => {
    return request(app)
      .get('/api/v2/user/verify')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
        expect(response.body).toHaveProperty('ocId', 0)
      })
  })

  test('responds well with an access_token query string value', () => {
    const postMock = jest.mocked(got.post)

    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })

    return request(app)
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
    return request(app)
      .get('/api/v2/test')
      .type('json')
      .then((response) => {
        expect(response.status).toEqual(401)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('error')
      })
  })

  test('responds well with an Authorization header', () => {
    return request(app)
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
    return request(app)
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
    return request(app)
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
    return request(app)
      .post('/api/v2/convert/shapefile/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/telepac-parcelles.zip')
      .then((response) => {
        expect(response.status).toEqual(401)
      })
  })
})

describe('GET /api/v2/operateurs/:numeroBio/parcelles', () => {
  const getMock = jest.mocked(got.get)
  const postMock = jest.mocked(got.post)
  const queryMock = jest.mocked(db.query)

  test('it works with a valid numerobio and an OC token', async () => {
    // 1. AUTHORIZATION check token
    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })

    // 2. enforceRecord + getOperatorByNumeroBio
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })
    queryMock.mockResolvedValueOnce({ rows: [record] })

    return request(app)
      .get('/api/v2/operateurs/1234/parcelles')
      .type('json')
      .set('Authorization', fakeOcToken)
      .then((response) => {
        expect(response.status).toEqual(200)
      })
  })

  test('it works with a valid numerobio and a CartoBio token', () => {
    // 1. enforceRecord + getOperatorByNumeroBio
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })
    queryMock.mockResolvedValueOnce({ rows: [record] })

    return request(app)
      .get('/api/v2/operateurs/1234/parcelles')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
      })
  })

  test('it fails with an unknown numerobio and a valid OC token', () => {
    // 1. AUTHORIZATION check token
    postMock.mockReturnValueOnce({
      async json () {
        return fakeOc
      }
    })

    // 2. enforceRecord + getOperatorByNumeroBio
    getMock.mockResolvedValueOnce(null)
    queryMock.mockResolvedValueOnce({ rows: [] })

    return request(app)
      .get('/api/v2/operateurs/1234/parcelles')
      .type('json')
      .set('Authorization', fakeOcToken)
      .then((response) => {
        expect(response.status).toEqual(404)
      })
  })

  test('it fails with a valid numerobio and an invalid OC token', () => {
    postMock.mockReturnValueOnce({
      async json () {
        // eslint-disable-next-line no-throw-literal
        throw { code: 'ERR_NON_2XX_3XX_RESPONSE' }
      }
    })

    return request(app)
      .get('/api/v2/operateurs/1234/parcelles')
      .type('json')
      .set('Authorization', fakeOcToken)
      .then((response) => {
        expect(response.status).toEqual(401)
      })
  })
})

describe('PATCH /api/v2/audits/:recordId/parcelles', () => {
  const fakeAbToken = 'abtoken-bbbb-cccc-dddd'
  const getMock = jest.mocked(got.get)
  const postMock = jest.mocked(got.post)
  const queryMock = jest.mocked(db.query)

  test('it updates only the patched properties of the features', () => {
    // 1. fetchAuthToken
    postMock.mockReturnValueOnce({
      async json () {
        return { token: fakeAbToken }
      }
    })

    // 2. enforceRecord + fetchOperatorById
    queryMock.mockResolvedValueOnce({ rows: [record] })
    getMock.mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    })

    // 3. UPDATE
    queryMock.mockResolvedValueOnce({ rows: [patchedRecordExpectation] })

    return request(app)
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
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.body).toEqual(patchedRecordExpectation)
        expect(queryMock.mock.lastCall).toHaveProperty('1', [
          '054f0d70-c3da-448f-823e-81fcf7c2bf6e',
          patchedRecordExpectation.parcelles,
          null
        ])
      })
  })
})
