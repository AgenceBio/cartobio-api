import pool from '../../../src/database/database.js'
import { parseAPIParcellaireStream, getCurrentStatusJobs, updateImportJobStatus, updateStatus } from '../../../src/modules/imports/imports.service.js'

import { fetchOperatorByNumeroBio } from '../../../src/clients/agence-bio.client.js'
import { buildOperator, mockedQuery, queryResult } from '../../factories.js'

vi.mock('../../../src/clients/agence-bio.client.js')
vi.mock('../../../src/database/database.js')
vi.mock('../../../src/shared/parcellaires/parcellaires.service.js')
vi.mock('jsonstream-next')
vi.mock('../../../src/modules/imports/imports.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  collectFullValidationResults: vi.fn(),
  createImportJob: vi.fn(),
  processFullJob: vi.fn()
}))

const mockFetchOperatorByNumeroBio = fetchOperatorByNumeroBio

type ParsedItem = Awaited<ReturnType<ReturnType<typeof parseAPIParcellaireStream>['next']>>['value']

function recordOf (value: ParsedItem) {
  if (value && 'record' in value && value.record) return value.record
  throw new Error('aucun record valide renvoyé')
}
const mockPool = pool

describe('parseAPIParcellaireStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    }))

    const generator = parseAPIParcellaireStream(validRecord, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toHaveProperty('record')
    expect(recordOf(result.value).numerobio).toBe('99999')
    expect(recordOf(result.value).parcelles.features).toHaveLength(1)
  })

  test('gère un numeroBio inconnu', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithUnknownBio = [{
      numeroBio: 'UNKNOWN',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: []
    }]

    vi.mocked(mockFetchOperatorByNumeroBio).mockRejectedValueOnce(new Error('Numéro bio inconnu'))

    const generator = parseAPIParcellaireStream(recordWithUnknownBio, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: 'UNKNOWN',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: 'Numéro bio inconnu du portail de notification'
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: false,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    }))

    const generator = parseAPIParcellaireStream(record, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '12345',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: 'Numéro bio sans notification liée à une activité de production'
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    }))

    const generator = parseAPIParcellaireStream(record, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '99999',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/Numéro client différent/)
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '110077'
      }
    }))

    const generator = parseAPIParcellaireStream(recordWithInvalidGeom, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '101903',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/champ geom incorrect/)
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '110077'
      }
    }))

    const generator = parseAPIParcellaireStream(recordWithNaNGeom, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '101903',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/champ geom incorrect/)
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '110077'
      }
    }))

    const generator = parseAPIParcellaireStream(recordWithInfinityGeom, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '101903',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/champ geom incorrect/)
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '195931'
      }
    }))

    const generator = parseAPIParcellaireStream(recordWithNoCultures, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '172301',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: 'cultures absentes'
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    }))

    const generator = parseAPIParcellaireStream(recordWithInvalidState, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '77777',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: 'champ etatProduction incorrect'
        })
      ])
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

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '195931'
      }
    }))

    const generator = parseAPIParcellaireStream(recordWithMissingDate, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value).toMatchObject({
      numeroBio: '172301',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/date d'engagement obligatoire/)
        })
      ])
    })
  })

  test('accepte un payload contenant un seul objet', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = {
      numeroBio: '99999',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      dateCertificationDebut: '2023-01-01',
      dateCertificationFin: '2025-03-31',
      parcelles: [{
        id: '45742',
        etatProduction: 'AB',
        geom: '[[[4.874099,44.255949],[4.873961,44.255016],[4.873653,44.255001],[4.874099,44.255949]]]',
        culture: [{ codeCPF: '01.92', quantite: 25, unite: '%' }]
      }]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: { id: 1, nom: 'Ecocert France', numeroClient: '100012' }
    }))

    const result = await parseAPIParcellaireStream(record, { organismeCertificateur }).next()
    expect(recordOf(result.value).numerobio).toBe('99999')
  })

  test('retourne toutes les erreurs d’une même parcelle', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = [{
      numeroBio: '77777',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: [{
        id: '45742',
        etatProduction: 'invalide',
        geom: 'géométrie invalide'
      }]
    }]

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    }))

    const generator = parseAPIParcellaireStream(record, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value?.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ idParcelle: '45742', code: 'INVALID_ETAT_PRODUCTION' }),
      expect.objectContaining({ idParcelle: '45742', code: 'MISSING_CULTURES' }),
      expect.objectContaining({ idParcelle: '45742', code: 'INVALID_GEOM' })
    ]))
  })

  test('retourne aucune erreur avec le code cpf de culture inconnu', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = [{
      numeroBio: '77777',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      dateCertificationDebut: '2022-01-01',
      dateCertificationFin: '2052-01-01',
      parcelles: [{
        id: '45742',
        dateEngagement: '2023-04-27',
        etatProduction: 'AB',
        geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
        culture: [{
          codeCPF: 'ACT.Prod.Inc',
          quantite: 25,
          unite: '%'
        }]
      }]
    }]

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(buildOperator({
      isProduction: true,
      organismeCertificateur: {
        id: 1,
        nom: 'Ecocert France',
        numeroClient: '100012'
      }
    }))

    const generator = parseAPIParcellaireStream(record, { organismeCertificateur })
    const result = await generator.next()

    expect(result.value?.errors).toEqual(undefined)
  })
})

describe('getCurrentStatusJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("retourne une erreur si aucun job n'est trouvé", async () => {
    mockedQuery().mockResolvedValueOnce(queryResult([]))

    const result = await getCurrentStatusJobs(99, 1)

    expect(result).toEqual({
      status: 'error',
      error: "Aucun job n'a cet id"
    })
  })

  test('retourne un job en statut DONE', async () => {
    const mockDate = new Date()
    mockedQuery().mockResolvedValueOnce(queryResult([{
        status: 'DONE',
        result_job: { ok: true },
        ended_at: mockDate
      }]))

    const result = await getCurrentStatusJobs(1, 1)

    expect(result).toMatchObject({ status: 'DONE', result: { ok: true }, ended: mockDate })
  })

  test('retourne un job en statut PENDING', async () => {
    const mockDate = new Date()
    mockedQuery().mockResolvedValueOnce(queryResult([{
        status: 'PENDING',
        created_at: mockDate
      }]))

    const result = await getCurrentStatusJobs(1, 1)

    expect(result).toMatchObject({ status: 'PENDING', created: mockDate })
  })

  test('retourne un job en statut ERROR', async () => {
    const mockDate = new Date()
    mockedQuery().mockResolvedValueOnce(queryResult([{
        status: 'ERROR',
        result_job: 'Something went wrong',
        ended_at: mockDate
      }]))

    const result = await getCurrentStatusJobs(1, 1)

    expect(result).toMatchObject({ status: 'ERROR', error: 'Something went wrong', ended: mockDate })
  })
})

describe('updateImportJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('met à jour le job avec le statut DONE', async () => {
    mockedQuery().mockResolvedValueOnce(queryResult([]))

    await updateImportJobStatus(1, 'DONE', { foo: 'bar' })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE parcellaire_import SET status = $1, result_job = $2, ended_at = NOW() WHERE id = $3',
      ['DONE', { foo: 'bar' }, 1]
    )
  })

  test('met à jour le job avec le statut ERROR', async () => {
    mockedQuery().mockResolvedValueOnce(queryResult([]))

    await updateImportJobStatus(1, 'ERROR', { error: 'failed' })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE parcellaire_import SET status = $1, result_job = $2, ended_at = NOW() WHERE id = $3',
      ['ERROR', { error: 'failed' }, 1]
    )
  })

  test('met à jour le job avec le statut PENDING', async () => {
    mockedQuery().mockResolvedValueOnce(queryResult([]))

    await updateImportJobStatus(1, 'PENDING', { progress: 50 })

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE parcellaire_import SET status = $1, result_job = $2 WHERE id = $3',
      ['PENDING', { progress: 50 }, 1]
    )
  })
})

describe('updateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('considère comme une création un renvoi après un import rejeté', async () => {
    mockedQuery().mockResolvedValueOnce(queryResult([]))

    await updateStatus(42, {
      numeroBio: '12345',
      numeroClient: 'CLIENT-1',
      dateAudit: '2026-09-01'
    })

    const [query, params] = mockedQuery().mock.calls[0]
    expect(query).toContain('FROM cartobio_operators AS operator_record')
    expect(query).toContain('operator_record.deleted_at IS NULL')
    expect(query).not.toContain('FROM parcellaire_import AS previous_job')
    expect(params).toEqual(['12345', 'CLIENT-1', '2026-09-01', 42])
  })
})
