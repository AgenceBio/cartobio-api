import {
  getTableauErreursRepo,
  getTopAnomaliesGroupedRepo,
  getTopAnomaliesRepo
} from '../../../src/modules/tableau-de-bord/tableau-de-bord.repository.js'

const { results, executed, db } = vi.hoisted(() => {
  const results: unknown[] = []
  const executed = vi.fn()

  const builder = (): unknown => new Proxy(() => {}, {
    get: (_, key) => key === 'then'
      ? (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          executed()
          return Promise.resolve(results.shift()).then(resolve, reject)
        }
      : builder,
    apply: builder
  })

  const db = new Proxy({}, { get: (_, key) => key === 'then' ? undefined : builder })

  return { results, executed, db }
})

vi.mock('../../../src/database/database.js', () => ({ default: {}, db }))

describe('dashboard repository', () => {
  beforeEach(() => {
    results.length = 0
    executed.mockClear()
  })

  it('attache les logs au bon job dans le tableau des erreurs', async () => {
    results.push(
      [
        {
          jobId: 7,
          statut: 'REJECTED',
          etat: 'ERROR',
          numeroBio: 'BIO-7',
          numeroClient: 'CLIENT-7',
          auditDate: '2026-01-02',
          createdAt: '2026-01-02T10:00:00Z'
        }
      ],
      1,
      [
        {
          importId: 7,
          numeroBio: 'BIO-7',
          parcelleId: 9,
          parcelleName: 'P1',
          code: 'PARCELLE_INVALIDE',
          message: 'Parcelle inconnue'
        }
      ]
    )

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

    expect(executed).toHaveBeenCalledTimes(3)
  })

  it('ne demande pas les logs lorsque le tableau des erreurs est vide', async () => {
    results.push([], 0)

    await expect(
      getTableauErreursRepo({ page: 1, limit: 20 })
    ).resolves.toEqual({
      data: [],
      meta: { total: 0, page: 1, limit: 20 }
    })

    expect(executed).toHaveBeenCalledTimes(2)
  })

  it('retourne immédiatement une liste vide si la période des anomalies est incomplète', async () => {
    await expect(getTopAnomaliesRepo({ from: '2026-01-01' })).resolves.toEqual(
      []
    )
    await expect(
      getTopAnomaliesGroupedRepo({ to: '2026-01-31' })
    ).resolves.toEqual([])
    expect(executed).not.toHaveBeenCalled()
  })

  it('agrège les anomalies groupées par période et conserve les périodes vides', async () => {
    const period = new Date('2026-01-01T00:00:00.000Z')
    results.push([
      { period, accepted: 2, refused: 1, code: 'E1', errorCount: 3 },
      { period, accepted: 2, refused: 1, code: 'E2', errorCount: 1 },
      {
        period: new Date('2026-01-02T00:00:00.000Z'),
        accepted: 0,
        refused: 0,
        code: null,
        errorCount: 0
      }
    ])

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
