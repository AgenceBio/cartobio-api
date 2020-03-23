const app = require('.');
const request = require('supertest');

const {ESPACE_COLLABORATIF_BASIC_AUTH} = process.env;
const USER_DOC_AUTH_TOKEN = `Bearer eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJvY0lkIjowLCJ0ZXN0Ijp0cnVlfQ.NL050Bt_jMnQ6WLcqIbmwGJkaDvZ0PIAZdCKTNF_-sSTiTw5cijPGm6TwUSCWEyQUMFvI1_La19TDPXsaemDow`

describe('GET /', () => {
  test('responds with a 404', (done) => {
    request(app)
      .get('/')
      .type('json')
      .expect((response) => {
        expect(response.status).toBe(404)
        expect(response.header['content-type']).toBe('text/plain')
        expect(response.text).toBe('404 Not Found')
      })
      .end(done)
  })
})

describe('GET /api/v1/test', () => {
  test('fails when JWT is missing, or invalid', (done) => {
    request(app)
      .get('/api/v1/test')
      .type('json')
      .expect((response) => {
        expect(response.status).toBe(401)
        expect(response.header['content-type']).toBe('application/json')
        expect(response.body).toHaveProperty('error')
      })
      .end(done)
  })

  test('responds well', (done) => {
    request(app)
      .get('/api/v1/test')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_TOKEN)
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json')
        expect(response.body).toHaveProperty('test', 'OK')
      })
      .end(done)
  })
})

describe('GET /api/v1/parcels', () => {
  test('responds with hardcoded parels', (done) => {
    request(app)
      .get('/api/v1/parcels')
      .type('json')
      .set('Authorization', USER_DOC_AUTH_TOKEN)
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toBe('application/json')
        expect(response.body).toHaveProperty('type', 'FeatureCollection')
        expect(response.body.features).toHaveLength(5)
        expect(response.body.features).toHaveProperty(['0', 'properties', 'meta.year'], 2020)
        expect(response.body.features).toHaveProperty(['0', 'properties', 'meta.source'], 'RPG')
      })
      .end(done)
  })
})

describe('GET /espacecollaboratif/gcms/wfs/cartobio', () => {
  test('responds with XML', (done) => {
    request(app)
      .get('/espacecollaboratif/gcms/wfs/cartobio')
      .query({
        service: 'WFS',
        request: 'GetCapabilities',
      })
      .set('Authorization', `Basic ${ESPACE_COLLABORATIF_BASIC_AUTH}`)
      .type('xml')
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toContain('text/xml')
        expect(response.text).toContain('<ows:Operation name="GetCapabilities">')
      })
      .end(done)
  })
})

describe('GET /notifications/portail/departements', () => {
  test('responds with JSON', (done) => {
    request(app)
      .get('/notifications/portail/departements')
      .type('json')
      .expect((response) => {
        expect(response.status).toBe(200)
        expect(response.header['content-type']).toContain('application/json')
        expect(response.body[0]).toMatchObject({
          id: 1,
          nom: 'Toute la France',
          regionId: 1,
        })
      })
      .end(done)
  })
})

afterAll(() => app.close())
