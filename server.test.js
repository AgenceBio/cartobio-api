const { server: app, close, ready } = require('./server')
const config = require('./lib/config.js')
const request = require('supertest')
const { createSigner } = require('fast-jwt')

const sign = createSigner({ key: config.get('jwtSecret') })
const USER_DOC_AUTH_TOKEN = sign({ ocId: 0, test: true })
const USER_DOC_AUTH_HEADER = `Bearer ${USER_DOC_AUTH_TOKEN}`

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
        expect(response.status).toBe(404)
      })
  })
})

describe('GET /api/v2/test', () => {
  test('fails when JWT is missing, or invalid', () => {
    return request(app)
      .get('/api/v2/test')
      .type('json')
      .then((response) => {
        expect(response.status).toBe(401)
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
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toEqual({ message: 'OK' })
      })
  })

  test('responds well with an access_token query string', () => {
    return request(app)
      .get('/api/v2/test')
      .query({ access_token: USER_DOC_AUTH_TOKEN })
      .type('json')
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toEqual({ message: 'OK' })
      })
  })
})

describe('POST /api/v2/convert/shapefile/geojson', () => {
  test('it converts a L93 zipped archive into WGS84 GeoJSON', () => {
    return request(app)
      .post('/api/v2/convert/shapefile/geojson')
      .type('json')
      .attach('archive', 'test/fixtures/telepac-parcelles.zip')
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('features.0.type', 'Feature')
      })
  })
})
