// const JSONStream = require('jsonstream-next')
const pool = require('../db.js')
const {
  parseAPIParcellaireStream,
  getCurrentStatusJobs,
  updateImportJobStatus
} = require('./api-parcellaire.js')

const { fetchOperatorByNumeroBio } = require('./agence-bio.js')

jest.mock('./agence-bio.js')
jest.mock('../db.js')
jest.mock('./cartobio.js')
jest.mock('jsonstream-next')
jest.mock('./api-parcellaire.js', () => ({
  ...jest.requireActual('./api-parcellaire.js'),
  collectFullValidationResults: jest.fn(),
  createImportJob: jest.fn(),
  processFullJob: jest.fn()
}))

const mockFetchOperatorByNumeroBio = fetchOperatorByNumeroBio
const mockPool = pool

describe('parseAPIParcellaireStream', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('traite un enregistrement valide avec succès', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const validRecord = [{
      numeroBio: '99999',
      numeroClient: '100012',
      anneeReferenceControle: 2022,
      anneeAssolement: 2022,
      dateAudit: '2023-04-27',
      dateCertificationDebut: '2023-01-01',
      dateCertificationFin: '2025-03-31',
      numeroPacage: '084012821',
      parcelles: [{
        id: '45742',
        dateEngagement: '2023-04-27',
        etatProduction: 'AB',
        geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
        culture: [{
          codeCPF: '01.92',
          quantite: 25,
          unite: '%'
        }]
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    })

    const generator = parseAPIParcellaireStream(validRecord, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toHaveProperty('record')
    expect(result.value.record.numerobio).toBe('99999')
    expect(result.value.record.parcelles.features).toHaveLength(1)
  })

  test('gère un numeroBio inconnu', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithUnknownBio = [{
      numeroBio: 'UNKNOWN',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: []
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce(null)

    const generator = parseAPIParcellaireStream(recordWithUnknownBio, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: 'UNKNOWN',
      error: expect.objectContaining({
        message: 'Numéro bio inconnu du portail de notification'
      })
    })
  })

  test('gère un opérateur sans activité de production', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = [{
      numeroBio: '12345',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: []
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: false,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    })

    const generator = parseAPIParcellaireStream(record, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '12345',
      error: expect.objectContaining({
        message: 'Numéro bio sans notification liée à une activité de production'
      })
    })
  })

  test('gère un numéro client différent', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = [{
      numeroBio: '99999',
      numeroClient: 'WRONG_CLIENT',
      dateAudit: '2023-04-27',
      parcelles: []
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    })

    const generator = parseAPIParcellaireStream(record, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '99999',
      error: expect.objectContaining({
        message: expect.stringMatching(/Numéro client différent/)
      })
    })
  })

  test('gère une géométrie invalide', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithInvalidGeom = [{
      numeroBio: '101903',
      numeroClient: '110077',
      dateAudit: '2023-06-23',
      parcelles: [{
        id: 147079,
        dateEngagement: '2010-05-14',
        etatProduction: 'AB',
        geom: '[[[6.2708156467808749,47.590451080690947],[6.27081300234578,47.590451955729122]',
        cultures: [{
          codeCPF: '01.21.12',
          quantite: 1,
          unite: 'ha'
        }]
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '110077'
      }
    })

    const generator = parseAPIParcellaireStream(recordWithInvalidGeom, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '101903',
      error: expect.objectContaining({
        message: expect.stringMatching(/champ geom incorrect/)
      })
    })
  })

  test('gère des coordonnées NaN dans la géométrie', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithNaNGeom = [{
      numeroBio: '101903',
      numeroClient: '110077',
      dateAudit: '2023-06-23',
      parcelles: [{
        id: 147079,
        dateEngagement: '2010-05-14',
        etatProduction: 'AB',
        geom: '[[[null,47.590451],[6.270813,47.590451],[6.270813,47.590452],[null,47.590452],[null,47.590451]]]',
        cultures: [{
          codeCPF: '01.21.12',
          quantite: 1,
          unite: 'ha'
        }]
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '110077'
      }
    })

    const generator = parseAPIParcellaireStream(recordWithNaNGeom, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '101903',
      error: expect.objectContaining({
        message: expect.stringMatching(/champ geom incorrect/)
      })
    })
  })

  test('gère des coordonnées Infinity dans la géométrie', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    // JSON.parse ne peut pas sérialiser Infinity, on passe par une string JSON custom
    const recordWithInfinityGeom = [{
      numeroBio: '101903',
      numeroClient: '110077',
      dateAudit: '2023-06-23',
      parcelles: [{
        id: 147079,
        dateEngagement: '2010-05-14',
        etatProduction: 'AB',
        geom: '[[[1e309,47.590451],[6.270813,47.590451],[6.270813,47.590452],[1e309,47.590452],[1e309,47.590451]]]',
        cultures: [{
          codeCPF: '01.21.12',
          quantite: 1,
          unite: 'ha'
        }]
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '110077'
      }
    })

    const generator = parseAPIParcellaireStream(recordWithInfinityGeom, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '101903',
      error: expect.objectContaining({
        message: expect.stringMatching(/champ geom incorrect/)
      })
    })
  })

  test('gère des cultures absentes', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithNoCultures = [{
      numeroBio: '172301',
      numeroClient: '195931',
      dateAudit: '2023-03-30',
      parcelles: [{
        id: 124300,
        dateEngagement: '2022-08-17',
        etatProduction: 'C1',
        culture: []
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '195931'
      }
    })

    const generator = parseAPIParcellaireStream(recordWithNoCultures, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '172301',
      error: expect.objectContaining({
        message: 'cultures absentes'
      })
    })
  })

  test('gère un etatProduction invalide', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithInvalidState = [{
      numeroBio: '77777',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: [{
        id: '45742',
        etatProduction: 'invalide',
        geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
        culture: [{
          codeCPF: '01.92',
          quantite: 25,
          unite: '%'
        }]
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    })

    const generator = parseAPIParcellaireStream(recordWithInvalidState, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '77777',
      error: expect.objectContaining({
        message: 'champ etatProduction incorrect'
      })
    })
  })

  test('gère une dateEngagement manquante pour une parcelle en conversion', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithMissingDate = [{
      numeroBio: '172301',
      numeroClient: '195931',
      dateAudit: '2023-03-30',
      parcelles: [{
        id: 124300,
        dateEngagement: null,
        etatProduction: 'C1',
        geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
        culture: [{
          codeCPF: '01.92',
          quantite: 25,
          unite: '%'
        }]
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '195931'
      }
    })

    const generator = parseAPIParcellaireStream(recordWithMissingDate, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '172301',
      error: expect.objectContaining({
        message: expect.stringMatching(/date d'engagement obligatoire/)
      })
    })
  })

  test('gère correctement les métadonnées', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }

    const recordWithAssolement = [{
      numeroBio: '99999',
      numeroClient: '100012',
      anneeAssolement: 2022,
      dateAudit: '2023-04-27',
      parcelles: [{
        id: '45742',
        etatProduction: 'AB',
        geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
        culture: [{
          codeCPF: '01.92',
          quantite: 25,
          unite: '%'
        }]
      }]
    }]

    mockFetchOperatorByNumeroBio.mockResolvedValueOnce({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    })

    const generator = parseAPIParcellaireStream(recordWithAssolement, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value.record.metadata).toHaveProperty('anneeAssolement', 2022)
    expect(result.value.record.metadata).not.toHaveProperty('anneeReferenceControle')
  })
})

describe('getCurrentStatusJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test("retourne une erreur si aucun job n'est trouvé", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const result = await getCurrentStatusJobs(99)

    expect(result).toEqual({
      status: 'error',
      error: "Aucun job n'a cet id"
    })
  })

  test('retourne un job en statut DONE', async () => {
    const mockDate = new Date()
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        status: 'DONE',
        result_job: { ok: true },
        ended_at: mockDate
      }]
    })

    const result = await getCurrentStatusJobs(1)

    expect(result.status).toBe('DONE')
    expect(result.result).toMatchObject({ ok: true })
    expect(result.ended).toBe(mockDate)
  })

  test('retourne un job en statut PENDING', async () => {
    const mockDate = new Date()
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        status: 'PENDING',
        created_at: mockDate
      }]
    })

    const result = await getCurrentStatusJobs(1)

    expect(result.status).toBe('PENDING')
    expect(result.created).toBe(mockDate)
  })

  test('retourne un job en statut ERROR', async () => {
    const mockDate = new Date()
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        status: 'ERROR',
        result_job: 'Something went wrong',
        ended_at: mockDate
      }]
    })

    const result = await getCurrentStatusJobs(1)

    expect(result.status).toBe('ERROR')
    expect(result.error).toBe('Something went wrong')
    expect(result.ended).toBe(mockDate)
  })
})

describe('updateImportJobStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('met à jour le job avec le statut DONE', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    await updateImportJobStatus(1, 'DONE', { foo: 'bar' })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE parcellaire_import SET status=$1, result_job=$2, ended_at=NOW() WHERE id=$3',
      ['DONE', { foo: 'bar' }, 1]
    )
  })

  test('met à jour le job avec le statut ERROR', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    await updateImportJobStatus(1, 'ERROR', { error: 'failed' })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE parcellaire_import SET status=$1, result_job=$2, ended_at=NOW() WHERE id=$3',
      ['ERROR', { error: 'failed' }, 1]
    )
  })

  test('met à jour le job avec le statut PENDING', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    await updateImportJobStatus(1, 'PENDING', { progress: 50 })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE parcellaire_import SET status=$1, result_job=$2 WHERE id=$3',
      ['PENDING', { progress: 50 }, 1]
    )
  })
})
