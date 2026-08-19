import {
  getBilanPeriodeRepo,
  getEnvoisSuspectsRepo,
  getHistoriqueImportsRepo,
  getTableauErreursRepo,
  getTopAnomaliesGroupedRepo,
  getTopAnomaliesRepo
} from './repository'
const pool = require('../db.js')

const mockQuery = pool.query

describe('dashboard repository', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('calcule le bilan et le taux de refus arrondi', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ totalRecu: '11', totalAcceptes: '8', totalRefuses: '3' }]
    })

    await expect(getBilanPeriodeRepo('2026-01-01', '2026-01-31')).resolves.toEqual({
      totalRecu: 11, totalAcceptes: 8, totalRefuses: 3, tauxRefus: 27
    })

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('created_at >= $1'), [
      '2026-01-01', '2026-01-31'
    ])
  })

  it('retourne un taux de refus nul si aucun objet reçu', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ totalRecu: '0', totalAcceptes: '0', totalRefuses: '5' }]
    })

    await expect(getBilanPeriodeRepo()).resolves.toEqual({
      totalRecu: 0, totalAcceptes: 0, totalRefuses: 5, tauxRefus: 0
    })
  })

  it('mappe l’historique, convertit les compteurs et calcule la pagination', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          jobId: 42,
          status: 'DONE',
          created_at: new Date('2026-01-10T10:00:00.000Z'),
          ended_at: new Date('2026-01-10T10:05:00.000Z'),
          nb_objets_recu: '4',
          nb_objets_acceptes: '3',
          nb_objets_refuses: null
        }]
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })

    await expect(getHistoriqueImportsRepo({
      from: '2026-01-01', to: '2026-01-31', page: 2, limit: 10
    })).resolves.toEqual({
      data: [{
        jobId: 42,
        statut: 'DONE',
        createdAt: new Date('2026-01-10T10:00:00.000Z'),
        endedAt: new Date('2026-01-10T10:05:00.000Z'),
        nbObjetsRecus: 4,
        nbObjetsAcceptes: 3,
        nbObjetsRefuses: null
      }],
      meta: { total: 1, page: 2, limit: 10 }
    })

    expect(mockQuery.mock.calls[0][1]).toEqual([
      new Date('2026-01-01'), new Date('2026-01-31T23:59:59'), 10, 10
    ])
  })

  it('attache les logs au bon job dans le tableau des erreurs', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          jobId: 7,
          statut_job: 'REJECTED',
          etat: 'ERROR',
          audit_date: '2026-01-02',
          numerobio: 'BIO-7',
          numeroclient: 'CLIENT-7',
          created_at: '2026-01-02T10:00:00Z'
        }]
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          import_id: 7,
          numero_bio: 'BIO-7',
          parcelle_id: 9,
          parcelle_name: 'P1',
          code: 'PARCELLE_INVALIDE',
          message: 'Parcelle inconnue'
        }]
      })

    await expect(getTableauErreursRepo({ page: 1, limit: 20 })).resolves.toEqual({
      data: [{
        jobId: 7,
        statut: 'REJECTED',
        etat: 'ERROR',
        numeroBio: 'BIO-7',
        numeroClient: 'CLIENT-7',
        auditDate: '2026-01-02',
        createdAt: '2026-01-02T10:00:00Z',
        details: [{
          numeroBio: 'BIO-7',
          parcelleId: 9,
          parcelleName: 'P1',
          code: 'PARCELLE_INVALIDE',
          message: 'Parcelle inconnue'
        }]
      }],
      meta: { total: 1, page: 1, limit: 20 }
    })

    expect(mockQuery).toHaveBeenCalledTimes(3)
    expect(mockQuery.mock.calls[2][1]).toEqual([[7]])
  })

  it('ne demande pas les logs lorsque le tableau des erreurs est vide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })

    await expect(getTableauErreursRepo({ page: 1, limit: 20 })).resolves.toEqual({
      data: [], meta: { total: 0, page: 1, limit: 20 }
    })

    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('retourne immédiatement une liste vide si la période des anomalies est incomplète', async () => {
    await expect(getTopAnomaliesRepo({ from: '2026-01-01' })).resolves.toEqual([])
    await expect(getTopAnomaliesGroupedRepo({ to: '2026-01-31' })).resolves.toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('agrège les anomalies groupées par période et conserve les périodes vides', async () => {
    const period = new Date('2026-01-01T00:00:00.000Z')
    mockQuery.mockResolvedValueOnce({
      rows: [
        { period, accepted: '2', refused: '1', code: 'E1', error_count: '3' },
        { period, accepted: '2', refused: '1', code: 'E2', error_count: '1' },
        { period: new Date('2026-01-02T00:00:00.000Z'), accepted: '0', refused: '0', code: null, error_count: '0' }
      ]
    })

    const result = await getTopAnomaliesGroupedRepo({ from: '2026-01-01', to: '2026-01-02' })

    expect(result).toEqual([
      {
        period,
        accepted: 2,
        refused: 1,
        errorCount: 4,
        errors: [{ code: 'E1', count: 3 }, { code: 'E2', count: 1 }]
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

  it('ne conserve que les envois appartenant à une série suspecte', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { jobId: 1, numerobio: 'B1', numeroclient: 'C1', audit_date: '2026-01-01', statut_job: 'VALID', etat: 'DONE', created_at: '2026-01-01T08:00:00Z' },
          { jobId: 2, numerobio: 'B1', numeroclient: 'C1', audit_date: '2026-01-01', statut_job: 'VALID', etat: 'DONE', created_at: '2026-01-01T09:00:00Z' },
          { jobId: 3, numerobio: 'B1', numeroclient: 'C1', audit_date: '2026-01-01', statut_job: 'VALID', etat: 'DONE', created_at: '2026-01-01T10:00:00Z' },
          { jobId: 4, numerobio: 'B1', numeroclient: 'C1', audit_date: '2026-01-01', statut_job: 'REJECTED', etat: 'ERROR', created_at: '2026-01-01T11:00:00Z' }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })

    const result = await getEnvoisSuspectsRepo({ from: '2026-01-01', to: '2026-01-02', page: 1, limit: 8 })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ numeroBio: 'B1', numeroClient: 'C1', auditDate: '2026-01-01' })
    expect(result[0].envois.map((envoi) => envoi.jobId)).toEqual([1, 2, 3])
  })
})
