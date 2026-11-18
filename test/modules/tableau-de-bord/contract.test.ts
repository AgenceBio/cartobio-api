import request from 'supertest'
import {
  generalKpiResponseSchema,
  historiqueResponseSchema,
  repetitionsResponseSchema,
  STATS_MAX_LIMIT,
  tableauBilanResponseSchema,
  tableauErreursResponseSchema,
  topAnomaliesGroupedResponseSchema,
  topAnomaliesResponseSchema
} from '@agencebio/cartobio-types'
import type { z } from 'zod'
import app from '../../../src/app.js'
import { db } from '../../../src/database/database.js'
import { parcellaireImport, parcellaireImportLogs } from '../../../src/database/schema/index.js'
import { got } from '../../got-mock.js'

const oc = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }
const createdAt = new Date('2026-03-10T10:00:00Z')

async function insertJob(job: Partial<typeof parcellaireImport.$inferInsert>): Promise<number> {
  const [row] = await db
    .insert(parcellaireImport)
    .values({ organismeCertificateur: 999, status: 'DONE', createdAt, endedAt: createdAt, ...job })
    .returning({ id: parcellaireImport.id })
  return row!.id
}

beforeAll(() => app.ready())
afterAll(() => app.close())

beforeEach(async () => {
  got.post.mockReset()
  got.post.mockImplementation((() => ({
    async json() {
      return oc
    }
  })) as never)

  for (let i = 0; i < 4; i++) {
    const jobId = await insertJob({
      statutJob: 'REJECTED',
      etat: 'UNKNOWN',
      numeroBio: '12345',
      numeroClient: 'C1',
      auditDate: '2026-03-01',
      resultJob: { count: 1, numeroBioValid: [], numeroBioError: ['12345'] }
    })
    await db.insert(parcellaireImportLogs).values([
      { importId: jobId, type: 'error', code: 'INVALID_GEOM', message: 'champ geom incorrect', parcelleId: '1' },
      { importId: jobId, type: 'warning', code: 'GEOM_CORRECTED', message: 'corrigée' }
    ])
  }
  await insertJob({
    statutJob: 'VALID',
    etat: 'CREATED',
    numeroBio: '67890',
    numeroClient: 'C2',
    auditDate: '2026-03-02',
    resultJob: { count: 1, numeroBioValid: [{ numeroBio: '67890', nbParcelles: 1 }], numeroBioError: [] }
  })
  await insertJob({ status: 'PENDING', statutJob: null, endedAt: null })
  await insertJob({ statutJob: 'ERROR', numeroBio: null, numeroClient: null, auditDate: null })
})

const period = { from: '2026-03-08T00:00:00.000Z', to: '2026-03-12T23:59:59.999Z' }

test.each<[string, Record<string, string>, z.ZodType]>([
  ['/general-kpi', period, generalKpiResponseSchema],
  ['/tableau', period, tableauBilanResponseSchema],
  ['/tableau-errors', period, tableauErreursResponseSchema],
  ['/historique', { numeroBio: '12345', numeroClient: 'C1', auditDate: '2026-03-01' }, historiqueResponseSchema],
  ['/top-anomalies', period, topAnomaliesResponseSchema],
  ['/top-anomalies-grouped', period, topAnomaliesGroupedResponseSchema],
  ['/repet-ano', { from: '2026-01-01', to: '2026-12-31' }, repetitionsResponseSchema]
])('GET /api/v3/tdb-api%s respecte le contrat du package sur des données réelles', async (path, query, schema) => {
  const response = await request(app.server).get(`/api/v3/tdb-api${path}`).query(query).set('Authorization', 'jeton-oc')

  expect(response.status).toBe(200)
  expect(schema.safeParse(response.body).error).toBeUndefined()
})

test('le tableau des envois expose les cas limites avec des valeurs typées', async () => {
  const response = await request(app.server)
    .get('/api/v3/tdb-api/tableau')
    .query({ ...period, limit: '20' })
    .set('Authorization', 'jeton-oc')

  expect(response.status).toBe(200)
  const statuts = response.body.data.map(({ statut }: { statut: string | null }) => statut)
  expect(statuts).toEqual(expect.arrayContaining(['REJECTED', 'VALID', 'ERROR', null]))
  expect(response.body.data).toContainEqual(
    expect.objectContaining({ statut: 'ERROR', etat: 'UNKNOWN', numeroBio: null, numeroClient: null, auditDate: null })
  )
})

test('ne renvoie que les logs de type erreur dans les détails', async () => {
  const response = await request(app.server)
    .get('/api/v3/tdb-api/tableau-errors')
    .query(period)
    .set('Authorization', 'jeton-oc')

  const codes = response.body.data.flatMap(({ details }: { details: Array<{ code: string }> }) =>
    details.map(({ code }) => code)
  )
  expect(codes.length).toBeGreaterThan(0)
  expect(new Set(codes)).toEqual(new Set(['INVALID_GEOM']))
})

test('refuse une page plus grande que STATS_MAX_LIMIT', async () => {
  const accepte = await request(app.server)
    .get('/api/v3/tdb-api/tableau')
    .query({ limit: String(STATS_MAX_LIMIT) })
    .set('Authorization', 'jeton-oc')
  const refuse = await request(app.server)
    .get('/api/v3/tdb-api/tableau')
    .query({ limit: String(STATS_MAX_LIMIT + 1) })
    .set('Authorization', 'jeton-oc')

  expect(accepte.status).toBe(200)
  expect(refuse.status).toBe(400)
})
