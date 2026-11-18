import { eq } from 'drizzle-orm'
import { toIsoDateTime } from '@agencebio/cartobio-types'
import { db } from '../../../src/database/database.js'
import { parcellaireImport, parcellaires } from '../../../src/database/schema/index.js'
import {
  parseAPIParcellaire,
  getCurrentStatusJobs,
  updateImportJobStatus,
  updateStatus
} from '../../../src/modules/imports/imports.service.js'

import { fetchOperatorByNumeroBio } from '../../../src/clients/agence-bio.client.js'
import { buildOperator } from '../../factories.js'

vi.mock('../../../src/clients/agence-bio.client.js')
vi.mock('../../../src/shared/parcellaires/parcellaires.service.js')
vi.mock('../../../src/modules/imports/imports.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  collectValidationResult: vi.fn(),
  createImportJob: vi.fn(),
  processFullJob: vi.fn()
}))

const mockFetchOperatorByNumeroBio = fetchOperatorByNumeroBio

type ParsedItem = Awaited<ReturnType<typeof parseAPIParcellaire>>

function recordOf(value: ParsedItem) {
  if (value && 'record' in value && value.record) return value.record
  throw new Error('aucun record valide renvoyé')
}

async function insertJob(job: Partial<typeof parcellaireImport.$inferInsert> = {}): Promise<number> {
  const { id } = (
    await db
      .insert(parcellaireImport)
      .values({ organismeCertificateur: '1', ...job })
      .returning({ id: parcellaireImport.id })
  )[0]!

  return id
}

async function findJob(id: number): Promise<typeof parcellaireImport.$inferSelect> {
  const [job] = await db.select().from(parcellaireImport).where(eq(parcellaireImport.id, id))
  return job!
}

describe('parseAPIParcellaire', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('traite un enregistrement valide avec succès', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const validRecord = {
      numeroBio: '99999',
      numeroClient: '100012',
      anneeReferenceControle: 2022,
      anneeAssolement: 2022,
      dateAudit: '2023-04-27',
      dateCertificationDebut: '2023-01-01',
      dateCertificationFin: '2025-03-31',
      numeroPacage: '084012821',
      parcelles: [
        {
          id: '45742',
          dateEngagement: '2023-04-27',
          etatProduction: 'AB',
          geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
          culture: [
            {
              codeCPF: '01.92',
              quantite: 25,
              unite: '%' as const
            }
          ]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '100012'
        }
      })
    )

    const result = await parseAPIParcellaire(validRecord, { organismeCertificateur })

    expect(result).toHaveProperty('record')
    expect(recordOf(result).numerobio).toBe('99999')
    expect(recordOf(result).parcelles.features).toHaveLength(1)
  })

  test('gère un numeroBio inconnu', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const recordWithUnknownBio = {
      numeroBio: 'UNKNOWN',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: []
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockRejectedValueOnce(
      Object.assign(new Error('Numéro bio inconnu'), { response: { statusCode: 404 } })
    )

    const result = await parseAPIParcellaire(recordWithUnknownBio, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const record = {
      numeroBio: '12345',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: []
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: false,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '100012'
        }
      })
    )

    const result = await parseAPIParcellaire(record, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const record = {
      numeroBio: '99999',
      numeroClient: 'WRONG_CLIENT',
      dateAudit: '2023-04-27',
      parcelles: []
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '100012'
        }
      })
    )

    const result = await parseAPIParcellaire(record, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const recordWithInvalidGeom = {
      numeroBio: '101903',
      numeroClient: '110077',
      dateAudit: '2023-06-23',
      parcelles: [
        {
          id: 147079,
          dateEngagement: '2010-05-14',
          etatProduction: 'AB',
          geom: '[[[6.2708156467808749,47.590451080690947],[6.27081300234578,47.590451955729122]',
          culture: [
            {
              codeCPF: '01.21.12',
              quantite: 1,
              unite: 'ha' as const
            }
          ]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '110077'
        }
      })
    )

    const result = await parseAPIParcellaire(recordWithInvalidGeom, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const recordWithNaNGeom = {
      numeroBio: '101903',
      numeroClient: '110077',
      dateAudit: '2023-06-23',
      parcelles: [
        {
          id: 147079,
          dateEngagement: '2010-05-14',
          etatProduction: 'AB',
          geom: '[[[null,47.590451],[6.270813,47.590451],[6.270813,47.590452],[null,47.590452],[null,47.590451]]]',
          culture: [
            {
              codeCPF: '01.21.12',
              quantite: 1,
              unite: 'ha' as const
            }
          ]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '110077'
        }
      })
    )

    const result = await parseAPIParcellaire(recordWithNaNGeom, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const recordWithInfinityGeom = {
      numeroBio: '101903',
      numeroClient: '110077',
      dateAudit: '2023-06-23',
      parcelles: [
        {
          id: 147079,
          dateEngagement: '2010-05-14',
          etatProduction: 'AB',
          geom: '[[[1e309,47.590451],[6.270813,47.590451],[6.270813,47.590452],[1e309,47.590452],[1e309,47.590451]]]',
          culture: [
            {
              codeCPF: '01.21.12',
              quantite: 1,
              unite: 'ha' as const
            }
          ]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '110077'
        }
      })
    )

    const result = await parseAPIParcellaire(recordWithInfinityGeom, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const recordWithNoCultures = {
      numeroBio: '172301',
      numeroClient: '195931',
      dateAudit: '2023-03-30',
      parcelles: [
        {
          id: 124300,
          dateEngagement: '2022-08-17',
          etatProduction: 'C1',
          culture: []
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '195931'
        }
      })
    )

    const result = await parseAPIParcellaire(recordWithNoCultures, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const recordWithInvalidState = {
      numeroBio: '77777',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: [
        {
          id: '45742',
          etatProduction: 'invalide',
          geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
          culture: [
            {
              codeCPF: '01.92',
              quantite: 25,
              unite: '%' as const
            }
          ]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '100012'
        }
      })
    )

    const result = await parseAPIParcellaire(recordWithInvalidState, { organismeCertificateur })

    expect(result).toMatchObject({
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
    const recordWithMissingDate = {
      numeroBio: '172301',
      numeroClient: '195931',
      dateAudit: '2023-03-30',
      parcelles: [
        {
          id: 124300,
          dateEngagement: null,
          etatProduction: 'C1',
          geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
          culture: [
            {
              codeCPF: '01.92',
              quantite: 25,
              unite: '%' as const
            }
          ]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '195931'
        }
      })
    )

    const result = await parseAPIParcellaire(recordWithMissingDate, { organismeCertificateur })

    expect(result).toMatchObject({
      numeroBio: '172301',
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/date d'engagement obligatoire/)
        })
      ])
    })
  })

  test("accepte une parcelle AB sans date d'engagement ni numéro PACAGE", async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = {
      numeroBio: '99999',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      dateCertificationDebut: '2023-01-01',
      dateCertificationFin: '2025-03-31',
      parcelles: [
        {
          id: '45742',
          etatProduction: 'AB',
          geom: '[[[4.874099,44.255949],[4.873961,44.255016],[4.873653,44.255001],[4.874099,44.255949]]]',
          culture: [{ codeCPF: '01.92', quantite: 25, unite: '%' as const }]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: { id: 1, nom: 'Ecocert France', numeroClient: '100012' }
      })
    )

    const result = await parseAPIParcellaire(record, { organismeCertificateur })
    expect(result.errors).toBeUndefined()
    expect(recordOf(result).numerobio).toBe('99999')
    expect(recordOf(result).parcelles.features).toHaveLength(1)
  })

  test('retourne toutes les erreurs d’une même parcelle', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = {
      numeroBio: '77777',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      parcelles: [
        {
          id: '45742',
          etatProduction: 'invalide',
          geom: 'géométrie invalide'
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '100012'
        }
      })
    )

    const result = await parseAPIParcellaire(record, { organismeCertificateur })

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ idParcelle: '45742', code: 'INVALID_ETAT_PRODUCTION' }),
        expect.objectContaining({ idParcelle: '45742', code: 'MISSING_CULTURES' }),
        expect.objectContaining({ idParcelle: '45742', code: 'INVALID_GEOM' })
      ])
    )
  })

  test('retourne aucune erreur avec le code cpf de culture inconnu', async () => {
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
    const record = {
      numeroBio: '77777',
      numeroClient: '100012',
      dateAudit: '2023-04-27',
      dateCertificationDebut: '2022-01-01',
      dateCertificationFin: '2052-01-01',
      parcelles: [
        {
          id: '45742',
          dateEngagement: '2023-04-27',
          etatProduction: 'AB',
          geom: '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]',
          culture: [
            {
              codeCPF: 'ACT.Prod.Inc',
              quantite: 25,
              unite: '%' as const
            }
          ]
        }
      ]
    }

    vi.mocked(mockFetchOperatorByNumeroBio).mockResolvedValueOnce(
      buildOperator({
        isProduction: true,
        organismeCertificateur: {
          id: 1,
          nom: 'Ecocert France',
          numeroClient: '100012'
        }
      })
    )

    const result = await parseAPIParcellaire(record, { organismeCertificateur })

    expect(result.errors).toEqual(undefined)
  })
})

describe('getCurrentStatusJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("retourne une erreur si aucun job n'est trouvé", async () => {
    const result = await getCurrentStatusJobs(99, 1)

    expect(result).toEqual({
      status: 'error',
      error: "Aucun job n'a cet id"
    })
  })

  test("ne retourne pas le job d'un autre organisme certificateur", async () => {
    const id = await insertJob({ status: 'DONE', resultJob: { ok: true }, endedAt: new Date() })

    expect(await getCurrentStatusJobs(id, 2)).toEqual({ status: 'error', error: "Aucun job n'a cet id" })
  })

  test('retourne un job en statut DONE', async () => {
    const mockDate = new Date()
    const id = await insertJob({
      status: 'DONE',
      resultJob: { ok: true },
      endedAt: mockDate
    })

    const result = await getCurrentStatusJobs(id, 1)

    expect(result).toMatchObject({ status: 'DONE', result: { ok: true }, ended: toIsoDateTime(mockDate) })
  })

  test('retourne un job en statut PENDING', async () => {
    const mockDate = new Date()
    const id = await insertJob({
      status: 'PENDING',
      createdAt: mockDate
    })

    const result = await getCurrentStatusJobs(id, 1)

    expect(result).toMatchObject({ status: 'PENDING', created: toIsoDateTime(mockDate) })
  })

  test('retourne un job en statut ERROR', async () => {
    const mockDate = new Date()
    const id = await insertJob({
      status: 'ERROR',
      resultJob: 'Something went wrong',
      endedAt: mockDate
    })

    const result = await getCurrentStatusJobs(id, 1)

    expect(result).toMatchObject({ status: 'ERROR', error: 'Something went wrong', ended: toIsoDateTime(mockDate) })
  })
})

describe('updateImportJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('met à jour le job avec le statut DONE', async () => {
    const id = await insertJob()

    await updateImportJobStatus(id, 'DONE', { foo: 'bar' })

    expect(await findJob(id)).toMatchObject({ status: 'DONE', resultJob: { foo: 'bar' }, endedAt: expect.any(Date) })
  })

  test('met à jour le job avec le statut ERROR', async () => {
    const id = await insertJob()

    await updateImportJobStatus(id, 'ERROR', { error: 'failed' })

    expect(await findJob(id)).toMatchObject({
      status: 'ERROR',
      resultJob: { error: 'failed' },
      endedAt: expect.any(Date)
    })
  })

  test('met à jour le job avec le statut PENDING', async () => {
    const id = await insertJob()

    await updateImportJobStatus(id, 'PENDING', { progress: 50 })

    expect(await findJob(id)).toMatchObject({ status: 'PENDING', resultJob: { progress: 50 }, endedAt: null })
  })
})

describe('updateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('considère comme une création un renvoi après un import rejeté', async () => {
    await insertJob({
      status: 'DONE',
      statutJob: 'REJECTED',
      numeroBio: '12345',
      numeroClient: 'CLIENT-1',
      auditDate: '2026-09-01'
    })
    const id = await insertJob()

    await updateStatus(id, {
      numeroBio: '12345',
      numeroClient: 'CLIENT-1',
      dateAudit: '2026-09-01'
    })

    expect(await findJob(id)).toMatchObject({
      numeroBio: '12345',
      numeroClient: 'CLIENT-1',
      auditDate: '2026-09-01',
      etat: 'CREATED'
    })
  })

  test('considère comme une mise à jour un renvoi pour un parcellaire existant', async () => {
    await db.insert(parcellaires).values({
      numeroBio: 12345,
      certificationEtat: 'AUDITED',
      versionNom: 'v1',
      auditDate: '2026-09-01',
      anneeReferenceControle: 2026
    })
    const id = await insertJob()

    await updateStatus(id, { numeroBio: '12345', numeroClient: 'CLIENT-1', dateAudit: '2026-09-01' })

    expect(await findJob(id)).toMatchObject({ etat: 'UPDATED' })
  })

  test("considère comme une création un parcellaire existant à une autre date d'audit", async () => {
    await db.insert(parcellaires).values({
      numeroBio: 12345,
      certificationEtat: 'AUDITED',
      versionNom: 'v1',
      auditDate: '2025-09-01',
      anneeReferenceControle: 2025
    })
    const id = await insertJob()

    await updateStatus(id, { numeroBio: '12345', numeroClient: 'CLIENT-1', dateAudit: '2026-09-01' })

    expect(await findJob(id)).toMatchObject({ etat: 'CREATED' })
  })

  test("laisse l'état inconnu quand une information manque ou que la date est invalide", async () => {
    const sansClient = await insertJob()
    const dateInvalide = await insertJob()

    await updateStatus(sansClient, { numeroBio: '12345', dateAudit: '2026-09-01' })
    await updateStatus(dateInvalide, { numeroBio: '12345', numeroClient: 'CLIENT-1', dateAudit: 'pas une date' })

    expect(await findJob(sansClient)).toMatchObject({ etat: 'UNKNOWN', numeroClient: null })
    expect(await findJob(dateInvalide)).toMatchObject({ etat: 'UNKNOWN', auditDate: null })
  })
})
