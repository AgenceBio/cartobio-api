const app = require('.');
const request = require('supertest');

const {ESPACE_COLLABORATIF_BASIC_AUTH} = process.env;

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

afterAll(() => app.close())
