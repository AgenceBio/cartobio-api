import request from 'supertest'
import app from '../../../src/app.js'
import * as repository from '../../../src/modules/system/system.repository.js'

beforeAll(() => app.ready())
afterAll(() => app.close())
afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/v3/health', () => {
  test('répond 200 quand la base est joignable', async () => {
    const response = await request(app.server).get('/api/v3/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'ok', db: 'ok' })
  })

  test('répond 503 quand la base est injoignable', async () => {
    vi.spyOn(repository, 'checkHealth').mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const response = await request(app.server).get('/api/v3/health')

    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ status: 'ok', db: 'unreachable' })
  })
})
