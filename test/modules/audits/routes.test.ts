import request from 'supertest'
import { and, eq, isNull } from 'drizzle-orm'
import { AttestationsProductionsType } from '@agencebio/cartobio-types'
import type { CartoBioUser } from '@agencebio/cartobio-types'
import app from '../../../src/app.js'
import { db } from '../../../src/database/database.js'
import { parcellaires, parcelles, parcellesControles } from '../../../src/database/schema/index.js'
import { getCachedUserProfile, getHistoryUser, signAccessToken } from '../../../src/modules/auth/auth.service.js'
import {
  deleteRecordAttestations,
  findValidAttestationProduction
} from '../../../src/modules/exports/exports.service.js'
import { got } from '../../got-mock.js'
import { loadRecordFixture } from '../../utils.js'
import agencebioOperator from '../../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

vi.mock('../../../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCachedUserProfile: vi.fn(),
  getHistoryUser: vi.fn()
}))
vi.mock('../../../src/modules/exports/exports.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  findValidAttestationProduction: vi.fn(),
  deleteRecordAttestations: vi.fn()
}))

const sign = (user: { id: number }): string => signAccessToken(user.id)
const fakeOc = { id: 999, nom: 'CartobiOC', numeroControleEu: 'FR-BIO-999' }
const fakeUser = {
  id: 1,
  prenom: 'Tonio',
  nom: 'Est',
  organismeCertificateur: fakeOc,
  groups: [
    { id: '8', nom: 'Auditeur' },
    { id: '2', nom: 'Chargé de certification' }
  ],
  mainGroup: { id: '8', nom: 'Auditeur' }
}
const AUTH = `Bearer ${sign(fakeUser)}`
const CERTIFIED = '054f0d70-c3da-448f-823e-81fcf7c11112'
const PENDING = '054f0d70-c3da-448f-823e-81fcf7c2bf6e'
const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [2.0, 47.0],
      [2.001, 47.0],
      [2.001, 47.001],
      [2.0, 47.001],
      [2.0, 47.0]
    ]
  ]
}

beforeAll(() => app.ready())
afterAll(() => app.close())
beforeEach(async () => {
  await loadRecordFixture()
  vi.mocked(getCachedUserProfile).mockResolvedValue(fakeUser as unknown as CartoBioUser)
  vi.mocked(getHistoryUser).mockResolvedValue(fakeUser as unknown as CartoBioUser)
  vi.mocked(deleteRecordAttestations).mockResolvedValue(undefined)
  got.get.mockReturnValue({
    async json() {
      return agencebioOperator
    }
  })
})
afterEach(() => {
  vi.clearAllMocks()
  got.get.mockReset()
})

const activeParcelles = (recordId: string) =>
  db
    .select({ id: parcelles.id, fromParcelles: parcelles.fromParcelles })
    .from(parcelles)
    .where(and(eq(parcelles.recordId, recordId), isNull(parcelles.deletedAt)))

describe('GET /api/v2/audits/:recordId/has-attestation-production', () => {
  test('cherche une attestation complète par défaut', async () => {
    vi.mocked(findValidAttestationProduction).mockResolvedValueOnce(null)

    const response = await request(app.server)
      .get(`/api/v2/audits/${CERTIFIED}/has-attestation-production`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ hasAttestationProduction: false })
    expect(findValidAttestationProduction).toHaveBeenCalledWith(CERTIFIED, AttestationsProductionsType.COMPLET)
  })

  test('cherche une attestation PAC avec pac=true', async () => {
    vi.mocked(findValidAttestationProduction).mockResolvedValueOnce({ path: import.meta.filename })

    const response = await request(app.server)
      .get(`/api/v2/audits/${CERTIFIED}/has-attestation-production?pac=true`)
      .set('Authorization', AUTH)

    expect(response.body).toEqual({ hasAttestationProduction: true })
    expect(findValidAttestationProduction).toHaveBeenCalledWith(CERTIFIED, AttestationsProductionsType.PACCOMPLET)
  })
})

describe('POST /api/v2/audits/:recordId/:id/(non-)controlee', () => {
  test('marque puis démarque une parcelle comme contrôlée', async () => {
    const controlled = await request(app.server)
      .post(`/api/v2/audits/${CERTIFIED}/1/controlee`)
      .set('Authorization', AUTH)
    expect(controlled.status).toBe(200)
    expect(controlled.body).toEqual({ controlee: true })
    expect(await db.select().from(parcellesControles).where(eq(parcellesControles.recordId, CERTIFIED))).toHaveLength(1)

    const uncontrolled = await request(app.server)
      .post(`/api/v2/audits/${CERTIFIED}/1/non-controlee`)
      .set('Authorization', AUTH)
    expect(uncontrolled.body).toEqual({ controlee: false })
    expect(await db.select().from(parcellesControles).where(eq(parcellesControles.recordId, CERTIFIED))).toHaveLength(0)
  })

  test.each(['controlee', 'non-controlee'])('retourne une 404 pour une parcelle inconnue (%s)', async (action) => {
    const response = await request(app.server)
      .post(`/api/v2/audits/${CERTIFIED}/inconnue/${action}`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(response.body.message).toBe('Parcelle introuvable')
  })
})

describe('DELETE /api/v2/audits/:recordId', () => {
  test('supprime logiquement le parcellaire et ses attestations', async () => {
    const response = await request(app.server).delete(`/api/v2/audits/${CERTIFIED}`).set('Authorization', AUTH)

    expect(response.status).toBe(204)
    const [stored] = await db
      .select({ deletedAt: parcellaires.deletedAt })
      .from(parcellaires)
      .where(eq(parcellaires.recordId, CERTIFIED))
    expect(stored?.deletedAt).not.toBeNull()
    expect(deleteRecordAttestations).toHaveBeenCalledWith(CERTIFIED)
  })

  test('refuse une requête anonyme', async () => {
    const response = await request(app.server).delete(`/api/v2/audits/${CERTIFIED}`)

    expect(response.status).toBe(401)
  })
})

describe('PATCH /api/v2/audits/:recordId', () => {
  test("passe le parcellaire à l'état audité et renseigne la date d'audit", async () => {
    const response = await request(app.server)
      .patch(`/api/v2/audits/${PENDING}`)
      .set('Authorization', AUTH)
      .send({ certification_state: 'AUDITED', audit_notes: 'RAS' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ certification_state: 'AUDITED', audit_notes: 'RAS' })
    expect(response.body.audit_history.at(-1)).toMatchObject({
      type: 'CertificationStateChange',
      state: 'AUDITED'
    })
  })

  test("refuse un changement d'état à un utilisateur sans le rôle requis", async () => {
    vi.mocked(getCachedUserProfile).mockResolvedValue({
      ...fakeUser,
      groups: [{ id: '8', nom: 'Auditeur' }]
    } as unknown as CartoBioUser)

    const response = await request(app.server).patch(`/api/v2/audits/${PENDING}`).set('Authorization', AUTH).send({
      certification_state: 'CERTIFIED',
      certification_date_debut: '2025-01-01',
      certification_date_fin: '2025-12-31'
    })

    expect(response.status).toBe(403)
  })

  test('refuse la certification sans dates', async () => {
    const response = await request(app.server)
      .patch(`/api/v2/audits/${PENDING}`)
      .set('Authorization', AUTH)
      .send({ certification_state: 'CERTIFIED' })

    expect(response.status).toBe(400)
    expect(response.body.message).toBe('Les dates de certification sont manquantes.')
  })

  test('refuse une modification concurrente', async () => {
    const response = await request(app.server)
      .patch(`/api/v2/audits/${PENDING}`)
      .set('Authorization', AUTH)
      .set('If-Unmodified-Since', new Date('2000-01-01').toUTCString())
      .send({ audit_notes: 'trop tard' })

    expect(response.status).toBe(412)
  })

  test('refuse une propriété inconnue', async () => {
    const response = await request(app.server)
      .patch(`/api/v2/audits/${PENDING}`)
      .set('Authorization', AUTH)
      .send({ inconnue: true })

    expect(response.status).toBe(400)
  })
})

describe('parcelles', () => {
  test('GET liste les parcelles du parcellaire', async () => {
    const response = await request(app.server).get(`/api/v2/audits/${PENDING}/parcelles`).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.type).toBe('FeatureCollection')
    expect(response.body.features.map(({ id }: { id: string }) => id).sort()).toEqual(['1', '2', '3'])
  })

  test('POST ajoute une parcelle', async () => {
    const response = await request(app.server)
      .post(`/api/v2/audits/${PENDING}/parcelles`)
      .set('Authorization', AUTH)
      .send({
        feature: {
          type: 'Feature',
          geometry: polygon,
          properties: { cultures: [], conversion_niveau: 'AB' }
        }
      })

    expect(response.status).toBe(200)
    expect(response.body.parcelles.features).toHaveLength(4)
    expect(await activeParcelles(PENDING)).toHaveLength(4)
  })

  test('PATCH :featureId retourne une 404 pour une parcelle inconnue', async () => {
    const response = await request(app.server)
      .patch(`/api/v2/audits/${PENDING}/parcelles/inconnue`)
      .set('Authorization', AUTH)
      .send({ properties: { auditeur_notes: 'note' } })

    expect(response.status).toBe(404)
  })

  test('PATCH :featureId met à jour la parcelle', async () => {
    const response = await request(app.server)
      .patch(`/api/v2/audits/${PENDING}/parcelles/1`)
      .set('Authorization', AUTH)
      .send({ properties: { auditeur_notes: 'note', conversion_niveau: 'AB' } })

    expect(response.status).toBe(200)
    const feature = response.body.parcelles.features.find(({ id }: { id: string }) => id === '1')
    expect(feature.properties.auditeur_notes).toBe('note')
  })

  test('DELETE :featureId supprime la parcelle et historise le motif', async () => {
    const response = await request(app.server)
      .delete(`/api/v2/audits/${PENDING}/parcelles/2`)
      .set('Authorization', AUTH)
      .send({ reason: { code: 'error', reason: 'doublon' } })

    expect(response.status).toBe(200)
    expect(response.body.parcelles.features.map(({ id }: { id: string }) => id)).not.toContain('2')
    expect(response.body.audit_history.at(-1)).toMatchObject({
      type: 'FeatureDeletion',
      metadata: { reason: { code: 'error', reason: 'doublon' } }
    })
  })

  test('DELETE :featureId exige un motif', async () => {
    const response = await request(app.server)
      .delete(`/api/v2/audits/${PENDING}/parcelles/2`)
      .set('Authorization', AUTH)
      .send({})

    expect(response.status).toBe(400)
  })

  test('PUT remplace des parcelles par de nouvelles', async () => {
    const response = await request(app.server)
      .put(`/api/v2/audits/${PENDING}/parcelles`)
      .set('Authorization', AUTH)
      .send({
        features: [
          {
            type: 'Feature',
            geometry: polygon,
            properties: { cultures: [], conversion_niveau: 'AB' }
          }
        ],
        from: ['2', '3']
      })

    expect(response.status).toBe(200)
    const stored = await activeParcelles(PENDING)
    expect(stored.map(({ id }) => id)).not.toContain('2')
    expect(stored.map(({ id }) => id)).not.toContain('3')
    expect(stored.find(({ id }) => id !== '1')?.fromParcelles).toEqual(['2', '3'])
  })
})
