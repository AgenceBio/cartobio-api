const app = require('.')
const request = require('supertest')

const { ESPACE_COLLABORATIF_BASIC_AUTH } = require('./lib/app.js').env()
const USER_DOC_AUTH_TOKEN = 'Bearer eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJvY0lkIjowLCJ0ZXN0Ijp0cnVlfQ.NL050Bt_jMnQ6WLcqIbmwGJkaDvZ0PIAZdCKTNF_-sSTiTw5cijPGm6TwUSCWEyQUMFvI1_La19TDPXsaemDow'

describe('GET /', () => {
  test('responds with a 404', () => {
    return request(app)
      .get('/')
      .type('json')
      .expect((response) => {
        expect(response.status).toBe(404)
        expect(response.header['content-type']).toBe('text/plain')
        expect(response.text).toBe('404 Not Found')
      })
  })
})

describe('GET /api/v1/test', () => {
  test('fails when JWT is missing, or invalid', () => {
    return request(app)
      .get('/api/v1/test')
      .type('json')
      .expect((response) => {
        expect(response.status).toBe(401)
        expect(response.header['content-type']).toBe('application/json')
        expect(response.body).toHaveProperty('error')
      })
  })

  test('responds well', () => {
    return request(app)
      .get('/api/v1/test')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_TOKEN)
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json')
        expect(response.body).toHaveProperty('test', 'OK')
      })
  })
})

describe('GET /api/v1/parcels', () => {
  test('responds with hardcoded parels', () => {
    return request(app)
      .get('/api/v1/parcels')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_TOKEN)
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json')
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

describe('GET /espacecollaboratif/gcms/wfs/cartobio', () => {
  test('responds with XML', () => {
    return request(app)
      .get('/espacecollaboratif/gcms/wfs/cartobio')
      .query({
        service: 'WFS',
        request: 'GetCapabilities'
      })
      .set('Authorization', `Basic ${ESPACE_COLLABORATIF_BASIC_AUTH}`)
      .type('xml')
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toContain('text/xml')
        expect(response.text).toContain('<ows:Operation name="GetCapabilities">')
      })
  })
})

describe('GET /notifications/portail/departements', () => {
  test('responds with JSON', () => {
    return request(app)
      .get('/notifications/portail/departements')
      .type('json')
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toContain('application/json')
        expect(response.body[0]).toMatchObject({
          id: 1,
          nom: 'Toute la France',
          regionId: 1
        })
      })
  })
})

afterAll(() => app.close())
