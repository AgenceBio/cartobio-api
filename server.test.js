const { server: app, close, ready } = require('./server')
const config = require('./lib/config.js')
const request = require('supertest')
const { createSigner } = require('fast-jwt')
const got = require('got')
const db = require('./lib/db.js')

const agencebioOperator = require('./lib/providers/__fixtures__/agence-bio-operateur.json')
const record = require('./lib/providers/__fixtures__/record.json')
const parcelles = require('./lib/providers/__fixtures__/parcelles.json')
const parcellesPatched = require('./lib/providers/__fixtures__/parcelles-patched.json')
const apiParcellaire = require('./lib/providers/__fixtures__/agence-bio-api-parcellaire.json')
const { normalizeRecord } = require('./lib/outputs/record')
const { normalizeOperator } = require('./lib/outputs/operator')
const { recordToApi } = require('./lib/outputs/api')

const sign = createSigner({ key: config.get('jwtSecret') })

const fakeOcToken = 'aaaa-bbbb-cccc-dddd'
const fakeOc = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }
const USER_DOC_AUTH_TOKEN = sign({ ocId: 999, test: true, organismeCertificateur: fakeOc })
const USER_DOC_AUTH_HEADER = `Bearer ${USER_DOC_AUTH_TOKEN}`

// start and stop server
beforeAll(() => ready())
afterAll(() => close())
afterEach(() => jest.clearAllMocks())

jest.mock('got', () => ({
  get: jest.fn(),
  post: jest.fn()
}))

jest.mock('./lib/db.js', () => ({
  query: jest.fn(),
  connect: jest.fn()
}))

const clientQuery = jest.fn()
const clientRelease = jest.fn()
db.connect.mockResolvedValue({
  query: clientQuery,
  release: clientRelease
})

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

    return request(app)
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

    return request(app)
      .post('/api/v2/certification/operators/search')
      .send({ input: 'ferme 1234' })
      .set('Authorization', USER_DOC_AUTH_HEADER)
      .then((response) => {
        expect(response.status).toEqual(200)
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
    queryMock.mockResolvedValueOnce({ rows: parcelles })

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
    queryMock.mockResolvedValueOnce({ rows: parcelles })

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

  test('it updates only the patched properties of the features', async () => {
    clientQuery.mockClear()
    queryMock.mockClear()
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
      record: {
        ...record,
        parcelles: parcellesPatched
      },
      operator: normalizeOperator(agencebioOperator)
    })

    const response = await request(app)
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
    async (sql, [,, geometry] = []) => {
      if (sql.includes('INTO cartobio_parcelles') && !geometry) {
        // Simulate trigger error
        const err = new Error('No geometry')
        err.code = '23502'
        throw err
      }

      return ({ rows: [record] })
    }
  )

  test('it fails without auth', async () => {
    const res = await request(app).post('/api/v2/certification/parcelles').send(apiParcellaire)
    expect(db.query).not.toHaveBeenCalled()
    expect(db.connect).not.toHaveBeenCalled()
    expect(res.status).toBe(401)
  })

  test('it responds with 400 when body is not valid JSON', async () => {
    const res = await request(app)
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
    const res = await request(app)
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
        '[#3] champ geom incorrect : Unexpected end of JSON input',
        '[#4] La donnée géographique est manquante ou invalide.'
      ]
    })
  })

  test('it responds with 202 when records are valid and save everything to database', async () => {
    const validApiParcellaire = JSON.parse(JSON.stringify(apiParcellaire))
    validApiParcellaire.splice(1, 1)
    validApiParcellaire[1].parcelles[0].geom = '[[[0,0],[0,1],[1,1],[1,0],[0,0]]]'
    validApiParcellaire[2].parcelles[0].geom = '[[[0,0],[0,1],[1,1],[1,0],[0,0]]]'
    const res = await request(app)
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
  test('it responds with 404 when no operator is found', async () => {
    const queryMock = jest.mocked(db.query)
    queryMock.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .get('/api/v2/certification/parcellaire/1234')
      .set('Authorization', fakeOcToken)
    expect(res.status).toBe(404)
  })

  test('it responds with 200 when operator is found', async () => {
    const queryMock = jest.mocked(db.query)
    queryMock.mockResolvedValueOnce({ rows: [record] })
    queryMock.mockResolvedValueOnce({ rows: parcelles })

    const res = await request(app)
      .get('/api/v2/certification/parcellaire/1234')
      .set('Authorization', fakeOcToken)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(
      recordToApi(
        normalizeRecord({
          record: { parcelles, ...record },
          operator: normalizeOperator(agencebioOperator)
        })
      )
    )
  })
})
