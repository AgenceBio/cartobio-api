const { Readable } = require('stream')
const JSONStream = require('jsonstream-next')
const pool = require('../db.js')
const { createOrUpdateOperatorRecord } = require('./cartobio.js')
const {
  parseAPIParcellaireStream,
  collectPreparseResults,
  createImportJob,
  getCurrentStatusJobs,
  updateImportJobStatus,
  processFullJob,
  fetchOperator
} = require('./api-parcellaire.js')

const { fetchOperatorByNumeroBio } = require('./agence-bio.js')

jest.mock('./agence-bio.js')
jest.mock('../db.js')
jest.mock('./cartobio.js')
jest.mock('jsonstream-next')

const mockFetchOperatorByNumeroBio = fetchOperatorByNumeroBio
const mockCreateOrUpdateOperatorRecord = createOrUpdateOperatorRecord
const mockPool = pool
const mockJSONStream = JSONStream

describe('parseAPIParcellaireStream', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('processes valid record successfully', async () => {
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

  test('handles unknown numeroBio', async () => {
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

  test('handles operator without production', async () => {
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

  test('handles different numeroClient', async () => {
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

  test('handles invalid geometry', async () => {
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

  test('handles missing cultures', async () => {
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

  test('handles invalid etatProduction', async () => {
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

  test('handles missing dateEngagement for conversion state', async () => {
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
        message: expect.stringMatching(/date dengagement obligatoire/)
      })
    })
  })

  test('handles metadata correctly', async () => {
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
describe('collectPreparseResults', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('collects all generator results', async () => {
    mockFetchOperatorByNumeroBio.mockResolvedValue({
      organismeCertificateur: { numeroClient: '456' }
    })

    const mockStream = {
      pipe: jest.fn().mockReturnValue(Readable.from([{ numeroBio: '123', numeroClient: '456' }]))
    }
    mockJSONStream.parse.mockReturnValue(mockStream.pipe())

    const stream = { pipe: jest.fn().mockReturnValue(mockStream.pipe()) }
    const results = await collectPreparseResults(stream)

    expect(results).toEqual([{ numeroBio: '123' }])
  })
})

describe('createImportJob', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('creates job in DB', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 42 }] })

    const id = await createImportJob({ foo: 'bar' })

    expect(id).toBe(42)
    expect(mockPool.query).toHaveBeenCalledWith(
      'INSERT INTO jobs_import (payload, status) VALUES ($1, $2) RETURNING id',
      [JSON.stringify({ foo: 'bar' }), 'CREATE']
    )
  })
})

describe('getCurrentStatusJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns error if no job found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const result = await getCurrentStatusJobs(99)

    expect(result).toEqual({
      status: 'error',
      error: "Aucun job n'a cet id"
    })
  })

  test('returns DONE job', async () => {
    const mockDate = new Date()
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        status: 'DONE',
        result: { ok: true },
        ended: mockDate
      }]
    })

    const result = await getCurrentStatusJobs(1)

    expect(result.status).toBe('DONE')
    expect(result.result).toMatchObject({ ok: true })
    expect(result.ended).toBe(mockDate)
  })

  test('returns PENDING job', async () => {
    const mockDate = new Date()
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        status: 'PENDING',
        created: mockDate
      }]
    })

    const result = await getCurrentStatusJobs(1)

    expect(result.status).toBe('PENDING')
    expect(result.created).toBe(mockDate)
  })

  test('returns ERROR job', async () => {
    const mockDate = new Date()
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        status: 'ERROR',
        result: 'Something went wrong',
        ended: mockDate
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

  test('updates job with DONE status', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    await updateImportJobStatus(1, 'DONE', { foo: 'bar' })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE jobs_import SET status=$1, result=$2, ended=NOW() WHERE id=$3',
      ['DONE', { foo: 'bar' }, 1]
    )
  })

  test('updates job with ERROR status', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    await updateImportJobStatus(1, 'ERROR', { error: 'failed' })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE jobs_import SET status=$1, result=$2, ended=NOW() WHERE id=$3',
      ['ERROR', { error: 'failed' }, 1]
    )
  })

  test('updates job with PENDING status', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    await updateImportJobStatus(1, 'PENDING', { progress: 50 })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE jobs_import SET status=$1, result=$2 WHERE id=$3',
      ['PENDING', { progress: 50 }, 1]
    )
  })
})

describe('processFullJob', () => {
  let mockClient

  beforeEach(() => {
    jest.clearAllMocks()
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    }
    mockPool.connect.mockResolvedValue(mockClient)
    mockPool.query.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  test('marks job as DONE when success', async () => {
    mockFetchOperatorByNumeroBio.mockResolvedValue({
      isProduction: true,
      organismeCertificateur: { numeroClient: '456' }
    })
    mockCreateOrUpdateOperatorRecord.mockResolvedValue()

    const validRecord = {
      numeroBio: '123',
      numeroClient: '456',
      dateAudit: '2023-01-01',
      parcelles: [
        {
          id: 1,
          geom: JSON.stringify([[[2.0, 46.0], [2.1, 46.0], [2.1, 46.1], [2.0, 46.1], [2.0, 46.0]]]),
          cultures: [{ codeCPF: '01.11.11', quantite: 1.5, unite: 'ha' }]
        }
      ]
    }

    const fakeStream = Readable.from([validRecord])

    await processFullJob(1, { id: 1, nom: 'Ecocert' }, fakeStream)

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE jobs_import SET status=$1, result=$2 WHERE id=$3',
      ['PENDING', '{}', 1]
    )
  })
})

describe('fetchOperator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns operator when API succeeds', async () => {
    const mockOperator = { numeroBio: '123' }
    mockFetchOperatorByNumeroBio.mockResolvedValueOnce(mockOperator)

    const op = await fetchOperator('123')

    expect(op).toEqual(mockOperator)
    expect(mockFetchOperatorByNumeroBio).toHaveBeenCalledWith('123')
  })

  test('returns null when API fails', async () => {
    mockFetchOperatorByNumeroBio.mockRejectedValueOnce(new Error('fail'))

    const op = await fetchOperator('456')

    expect(op).toBeNull()
  })
})
