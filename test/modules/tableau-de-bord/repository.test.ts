import { toIsoDateTime } from '@agencebio/cartobio-types'
import {
  getTableauErreursRepo,
  getTopAnomaliesGroupedRepo,
  getTopAnomaliesRepo
} from '../../../src/modules/tableau-de-bord/tableau-de-bord.repository.js'
import { db } from '../../../src/database/database.js'
import { parcellaireImportLogs, parcellaireImport } from '../../../src/database/schema/index.js'

const organismeCertificateur = 7

async function insertJob(job: Partial<typeof parcellaireImport.$inferInsert>): Promise<number> {
  const { id } = (
    await db
      .insert(parcellaireImport)
      .values({ organismeCertificateur: String(organismeCertificateur), status: 'DONE', ...job })
      .returning({ id: parcellaireImport.id })
  )[0]!

  return id
}

async function insertErrors(importId: number, codes: string[]): Promise<void> {
  await db.insert(parcellaireImportLogs).values(
    codes.map((code) => ({
      importId,
      type: 'error' as const,
      code,
      message: `Erreur ${code}`
    }))
  )
}

describe('dashboard repository', () => {
  it('attache les logs au bon job dans le tableau des erreurs', async () => {
    const createdAt = new Date('2026-01-02T10:00:00Z')
    const jobId = await insertJob({
      statutJob: 'REJECTED',
      etat: 'UNKNOWN',
      numeroBio: 'BIO-7',
      numeroClient: 'CLIENT-7',
      auditDate: '2026-01-02',
      createdAt
    })
    const autreJobId = await insertJob({ statutJob: 'VALID', createdAt })

    await db.insert(parcellaireImportLogs).values([
      {
        importId: jobId,
        type: 'error',
        numeroBio: 'BIO-7',
        parcelleId: '9',
        parcelleName: 'P1',
        code: 'PARCELLE_INVALIDE',
        message: 'Parcelle inconnue'
      },
      { importId: jobId, type: 'warning', code: 'AVERTISSEMENT', message: 'Avertissement' },
      { importId: autreJobId, type: 'error', code: 'AUTRE', message: 'Autre job' }
    ])

    await expect(getTableauErreursRepo({ page: 1, limit: 20, organismeCertificateur })).resolves.toEqual({
      data: [
        {
          jobId,
          statut: 'REJECTED',
          etat: 'UNKNOWN',
          numeroBio: 'BIO-7',
          numeroClient: 'CLIENT-7',
          auditDate: '2026-01-02',
          createdAt: toIsoDateTime(createdAt),
          details: [
            {
              numeroBio: 'BIO-7',
              parcelleId: '9',
              parcelleName: 'P1',
              code: 'PARCELLE_INVALIDE',
              message: 'Parcelle inconnue'
            }
          ]
        }
      ],
      meta: { total: 1, page: 1, limit: 20 }
    })
  })

  it("ne remonte pas les jobs d'un autre organisme dans le tableau des erreurs", async () => {
    await insertJob({ statutJob: 'REJECTED', organismeCertificateur: '8' })

    await expect(getTableauErreursRepo({ page: 1, limit: 20, organismeCertificateur })).resolves.toEqual({
      data: [],
      meta: { total: 0, page: 1, limit: 20 }
    })
  })

  it('retourne immédiatement une liste vide si la période des anomalies est incomplète', async () => {
    await expect(getTopAnomaliesRepo({ from: '2026-01-01', organismeCertificateur })).resolves.toEqual([])
    await expect(getTopAnomaliesGroupedRepo({ to: '2026-01-31', organismeCertificateur })).resolves.toEqual([])
  })

  it('agrège les anomalies groupées par période et conserve les périodes vides', async () => {
    const createdAt = new Date('2026-01-01T12:00:00Z')
    await insertJob({ statutJob: 'VALID', createdAt })
    await insertJob({ statutJob: 'VALID', createdAt })
    await insertErrors(await insertJob({ statutJob: 'REJECTED', createdAt }), ['E1', 'E1', 'E1', 'E2'])

    const result = await getTopAnomaliesGroupedRepo({
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-02T00:00:00Z',
      organismeCertificateur
    })

    expect(result).toEqual([
      {
        period: '2026-01-01T00:00:00.000Z',
        accepted: 2,
        refused: 1,
        errorCount: 4,
        errors: [
          { code: 'E1', count: 3 },
          { code: 'E2', count: 1 }
        ]
      },
      {
        period: '2026-01-02T00:00:00.000Z',
        accepted: 0,
        refused: 0,
        errorCount: 0,
        errors: []
      }
    ])
  })
})
