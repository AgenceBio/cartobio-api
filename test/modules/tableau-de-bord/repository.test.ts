import {
  getTableauErreursRepo,
  getTopAnomaliesGroupedRepo,
  getTopAnomaliesRepo
} from '../../../src/modules/tableau-de-bord/tableau-de-bord.repository.js'
import { mockedQuery, queryResult } from '../../factories.js'

vi.mock('../../../src/database/database.js')

const mockQuery = mockedQuery()

describe('dashboard repository', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('attache les logs au bon job dans le tableau des erreurs', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([
          {
            jobId: 7,
            statut_job: 'REJECTED',
            etat: 'ERROR',
            audit_date: '2026-01-02',
            numerobio: 'BIO-7',
            numeroclient: 'CLIENT-7',
            created_at: '2026-01-02T10:00:00Z'
          }
        ]))
      .mockResolvedValueOnce(queryResult([{ count: '1' }]))
      .mockResolvedValueOnce(queryResult([
          {
            import_id: 7,
            numero_bio: 'BIO-7',
            parcelle_id: 9,
            parcelle_name: 'P1',
            code: 'PARCELLE_INVALIDE',
            message: 'Parcelle inconnue'
          }
        ]))

    await expect(
      getTableauErreursRepo({ page: 1, limit: 20 })
    ).resolves.toEqual({
      data: [
        {
          jobId: 7,
          statut: 'REJECTED',
          etat: 'ERROR',
          numeroBio: 'BIO-7',
          numeroClient: 'CLIENT-7',
          auditDate: '2026-01-02',
          createdAt: '2026-01-02T10:00:00Z',
          details: [
            {
              numeroBio: 'BIO-7',
              parcelleId: 9,
              parcelleName: 'P1',
              code: 'PARCELLE_INVALIDE',
              message: 'Parcelle inconnue'
            }
          ]
        }
      ],
      meta: { total: 1, page: 1, limit: 20 }
    })

    expect(mockQuery).toHaveBeenCalledTimes(3)
    expect(mockQuery.mock.calls[2][1]).toEqual([[7]])
  })

  it('ne demande pas les logs lorsque le tableau des erreurs est vide', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ count: '0' }]))

    await expect(
      getTableauErreursRepo({ page: 1, limit: 20 })
    ).resolves.toEqual({
      data: [],
      meta: { total: 0, page: 1, limit: 20 }
    })

    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('retourne immédiatement une liste vide si la période des anomalies est incomplète', async () => {
    await expect(getTopAnomaliesRepo({ from: '2026-01-01' })).resolves.toEqual(
      []
    )
    await expect(
      getTopAnomaliesGroupedRepo({ to: '2026-01-31' })
    ).resolves.toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('agrège les anomalies groupées par période et conserve les périodes vides', async () => {
    const period = new Date('2026-01-01T00:00:00.000Z')
    mockQuery.mockResolvedValueOnce(queryResult([
        { period, accepted: '2', refused: '1', code: 'E1', error_count: '3' },
        { period, accepted: '2', refused: '1', code: 'E2', error_count: '1' },
        {
          period: new Date('2026-01-02T00:00:00.000Z'),
          accepted: '0',
          refused: '0',
          code: null,
          error_count: '0'
        }
      ]))

    const result = await getTopAnomaliesGroupedRepo({
      from: '2026-01-01',
      to: '2026-01-02'
    })

    expect(result).toEqual([
      {
        period,
        accepted: 2,
        refused: 1,
        errorCount: 4,
        errors: [
          { code: 'E1', count: 3 },
          { code: 'E2', count: 1 }
        ]
      },
      {
        period: new Date('2026-01-02T00:00:00.000Z'),
        accepted: 0,
        refused: 0,
        errorCount: 0,
        errors: []
      }
    ])
  })
})
