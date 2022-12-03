const { server: app, close, ready } = require('.')
const { version: packageVersion } = require('./package.json')
const request = require('supertest')
const { createDecoder, createSigner } = require('fast-jwt')

const USER_DOC_AUTH_TOKEN = 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJvY0lkIjowLCJ0ZXN0Ijp0cnVlfQ.NL050Bt_jMnQ6WLcqIbmwGJkaDvZ0PIAZdCKTNF_-sSTiTw5cijPGm6TwUSCWEyQUMFvI1_La19TDPXsaemDow'
const USER_DOC_AUTH_HEADER = `Bearer ${USER_DOC_AUTH_TOKEN}`

const decode = createDecoder()
const sign = createSigner({ algorithm: 'none' })

jest.mock('./lib/providers/agence-bio.js')
jest.mock('./lib/providers/cartobio.js')
jest.mock('./lib/parcels.js')

const { fetchAuthToken, fetchUserProfile, getCertificationBodyForPacage } = require('./lib/providers/agence-bio.js')
const { updateOperator } = require('./lib/providers/cartobio.js')
const { getOperatorSummary } = require('./lib/parcels.js')

// start and stop server
beforeAll(() => ready())
afterAll(() => close())

describe('GET /', () => {
  test('responds with a 404', () => {
    return request(app)
      .get('/')
      .type('json')
      .then((response) => {
        expect(response.status).toBe(404)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('error', 'Not Found')
      })
  })
})

describe('GET /api/v1/version', () => {
  test('responds with package.json version value', () => {
    return request(app)
      .get('/api/v1/version')
      .type('json')
      .then((response) => {
        expect(response.body).toHaveProperty('version', packageVersion)
      })
  })
})

describe('GET /api/v1/test', () => {
  test('fails when JWT is missing, or invalid', () => {
    return request(app)
      .get('/api/v1/test')
      .type('json')
      .then((response) => {
        expect(response.status).toBe(401)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('error')
      })
  })

  test('responds well with an Authorization header', () => {
    return request(app)
      .get('/api/v1/test')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('test', 'OK')
      })
  })

  test('responds well with an access_token query string', () => {
    return request(app)
      .get('/api/v1/test')
      .query({ access_token: USER_DOC_AUTH_TOKEN })
      .type('json')
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('test', 'OK')
      })
  })
})

describe('GET /api/v1/login', () => {
  test('fails with wrong credentials', () => {
    fetchAuthToken.mockRejectedValueOnce({ message: 'mot de passe incorrect' })

    return request(app)
      .post('/api/v1/login')
      .type('json')
      .send({ email: 'blah@example.org', password: 'blah' })
      .then((response) => {
        expect(response.status).toBe(401)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('error', 'mot de passe incorrect')
      })
  })

  test('succeed with correct credentials', () => {
    const userId = 1
    const agenceBioToken = sign({ id: userId, organismeCertificateurId: 0, groupes: [1, 5] }, 'test')

    fetchAuthToken.mockResolvedValueOnce(agenceBioToken)
    fetchUserProfile.mockResolvedValueOnce({
      token: agenceBioToken,
      userProfile: {
        id: userId,
        organismeCertificateurId: 0,
        organismeCertificateur: {
          id: 0
        }
      }
    })

    return request(app)
      .post('/api/v1/login')
      .type('json')
      .send({ email: 'test@example.com', password: '0000' })
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        // returned by `abio.org/api/auth/login`
        expect(decode(response.body.agencebio)).toHaveProperty('id', 1)
        expect(decode(response.body.agencebio)).toHaveProperty('organismeCertificateurId', 0)
        // mixed with `abio.org/api/users/:id` in app.js
        expect(decode(response.body.cartobio)).toHaveProperty('id', 1)
        expect(decode(response.body.cartobio)).toHaveProperty('userId', 1)
        expect(decode(response.body.cartobio)).toHaveProperty('ocId', 0)
        expect(decode(response.body.cartobio)).toHaveProperty('organismeCertificateurId', 0)
      })
  })
})

describe('PATCH /api/v1/operator/:numeroBio', () => {
  test('fails if not authenticated', () => {
    return request(app)
      .patch('/api/v1/operator/abcd')
      .type('json')
      .send({})
      .then((response) => {
        expect(response.status).toBe(401)
        expect(response.body.error).toBe('An API token must be provided.')
      })
  })

  test('fails with non-numeric numeroBio', () => {
    return request(app)
      .patch('/api/v1/operator/abcd')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .send({ numeroPacage: '000000000' })
      .then((response) => {
        expect(response.status).toBe(400)
        expect(response.body.message).toMatch('params/numeroBio must be integer')
      })
  })

  test('fails when pacage is not a 9 digits string', () => {
    return request(app)
      .patch('/api/v1/operator/1234')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .send({ numeroPacage: '12345678' })
      .then((response) => {
        expect(response.status).toBe(400)
        expect(response.body.message).toMatch('body/numeroPacage must match pattern')
      })
  })

  test('fails when numeroBio is not associated to ocId', () => {
    updateOperator.mockRejectedValueOnce({ operators: [] })

    return request(app)
      .patch('/api/v1/operator/1234')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .send({ numeroPacage: '123456789' })
      .then((response) => {
        expect(response.status).toBe(500)
        expect(response.body.error).toMatch('Sorry, we failed to update operator data.')
      })
  })

  test('succeeds to create/update pacage Id for a given numeroBio', () => {
    updateOperator.mockResolvedValueOnce({ numeroPacage: '123456789' })
    getOperatorSummary.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { numerobio: 1234, pacage: '123456789' },
          geometry: { type: 'Point', coordinates: [] }
        }
      ]
    })

    return request(app)
      .patch('/api/v1/operator/1234')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .send({ numeroPacage: '123456789' })
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty(['features', '0', 'properties', 'numerobio'], 1234)
        expect(response.body).toHaveProperty(['features', '0', 'properties', 'pacage'], '123456789')
      })
  })
})

describe('GET /api/v1/summary', () => {
  test('responds with hardcoded summary', () => {
    return request(app)
      .get('/api/v1/summary')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('type', 'FeatureCollection')
        expect(response.body.features).toHaveLength(2)
        expect(response.body.features[0].properties).toStrictEqual({
          pacage: '026000001',
          numerobio: 1,
          nom: 'Nom Opérateur',
          date_engagement: '2020-04-28',
          date_maj: '2020-05-12',
          departement: '26',
          active: true
        })

        expect(response.body.features[1].geometry).toStrictEqual({
          type: 'Point',
          coordinates: [
            5.242270244026442,
            44.6261547076767
          ]
        })
      })
  })
})

describe('GET /api/v1/parcels', () => {
  test('responds with hardcoded parcels', () => {
    return request(app)
      .get('/api/v1/parcels')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('type', 'FeatureCollection')
        expect(response.body.features).toHaveLength(5)
        expect(response.body.features[1].properties).toMatchObject({
          pacage: '026000001',
          codecultu: 'PPH',
          bio: 1,
          numparcel: 2,
          numilot: 1,
          numerobio: 1
        })
      })
  })
})

describe('GET /api/v1/pacage/:numeroPacage', () => {
  test('PACAGE exists, thus is associated with a numeroBio', () => {
    getCertificationBodyForPacage.mockResolvedValueOnce({ numeroBio: 100, ocId: 1 })

    return request(app)
      .get('/api/v1/pacage/024014889')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.body).toEqual({ numeroBio: 100, numeroPacage: '024014889', ocId: 1 })
      })
  })

  test('PACAGE does not exist, hence not being associated with a numeroBio', () => {
    getCertificationBodyForPacage.mockResolvedValueOnce({ numeroBio: null, ocId: null })

    return request(app)
      .get('/api/v1/pacage/024014889')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.body).toEqual({ numeroBio: null, numeroPacage: '024014889', ocId: null })
      })
  })

  test('fails if something goes wrong', () => {
    getCertificationBodyForPacage.mockRejectedValueOnce(new Error('API unreachable'))

    return request(app)
      .get('/api/v1/pacage/024014889')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(500)
        expect(response.body).toHaveProperty('error', 'Sorry, we failed to retrieve operator data. We have been notified about and will soon start fixing this issue.')
      })
  })
})

describe('GET /api/v1/parcels/operator/:numeroBio', () => {
  test('responds with hardcoded parcels', () => {
    return request(app)
      .get('/api/v1/parcels/operator/11')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('type', 'FeatureCollection')
        expect(response.body.features).toHaveLength(1)
        expect(response.body.features[0].properties).toMatchObject({
          pacage: '026000003',
          codecultu: 'BTH',
          bio: 1,
          numparcel: 1,
          numilot: 1,
          numerobio: 11
        })
      })
  })

  test('responds with an empty GeoJSON FeatureCollection', () => {
    return request(app)
      .get('/api/v1/parcels/operator/666')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('type', 'FeatureCollection')
        expect(response.body.features).toHaveLength(0)
      })
  })
})

describe('POST /api/v1/convert/shapefile/geojson', () => {
  test('it converts a L93 zipped archive into WGS84 GeoJSON', () => {
    return request(app)
      .post('/api/v1/convert/shapefile/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/telepac-parcelles.zip')
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('features.0.type', 'Feature')
      })
  })
})
