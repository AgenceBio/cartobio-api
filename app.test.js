const { server: app, close, ready } = require('.')
const request = require('supertest')

const USER_DOC_AUTH_TOKEN = 'Bearer eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJvY0lkIjowLCJ0ZXN0Ijp0cnVlfQ.NL050Bt_jMnQ6WLcqIbmwGJkaDvZ0PIAZdCKTNF_-sSTiTw5cijPGm6TwUSCWEyQUMFvI1_La19TDPXsaemDow'

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

  test('responds well', () => {
    return request(app)
      .get('/api/v1/test')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_TOKEN)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('test', 'OK')
      })
  })
})

describe('GET /api/v1/summary', () => {
  test('responds with hardcoded summary', () => {
    return request(app)
      .get('/api/v1/summary')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_TOKEN)
      .then((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json; charset=utf-8')
        expect(response.body).toHaveProperty('type', 'FeatureCollection')
        expect(response.body.features).toHaveLength(2)
        expect(response.body.features[0].properties).toMatchObject({
          pacage: '026000001',
          numerobio: 1,
          nom: 'Nom Opérateur',
          departement: '26',
          active: true
        })

        expect(response.body.features[1].geometry).toMatchObject({
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
  test('responds with hardcoded parels', () => {
    return request(app)
      .get('/api/v1/parcels')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_TOKEN)
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
