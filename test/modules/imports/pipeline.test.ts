import { eq } from 'drizzle-orm'
import { db } from '../../../src/database/database.js'
import {
  parcellaireImport,
  parcellaireImportLogs,
  parcellaireImportPayload,
  parcellaires,
  parcelleCultures,
  parcelles
} from '../../../src/database/schema/index.js'
import { fetchOperatorByNumeroBio } from '../../../src/clients/agence-bio.client.js'
import {
  collectValidationResult,
  createImportJob,
  processFullJob
} from '../../../src/modules/imports/imports.service.js'
import { buildOperator } from '../../factories.js'

vi.mock('../../../src/clients/agence-bio.client.js')

const organismeCertificateur = { id: 1, nom: 'Ecocert France' }
const geom =
  '[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]'

const payload = (overrides: Record<string, unknown> = {}) => ({
  numeroBio: '99999',
  numeroClient: '100012',
  anneeReferenceControle: 2026,
  anneeAssolement: 2026,
  dateAudit: '2026-04-27',
  dateCertificationDebut: '2026-01-01',
  dateCertificationFin: '2027-03-31',
  numeroPacage: '084012821',
  parcelles: [
    {
      id: '45742',
      dateEngagement: '2023-04-27',
      etatProduction: 'AB',
      geom,
      culture: [{ codeCPF: '01.92', quantite: 25, unite: '%' }]
    }
  ],
  ...overrides
})

async function findJob(id: number): Promise<typeof parcellaireImport.$inferSelect> {
  const [job] = await db.select().from(parcellaireImport).where(eq(parcellaireImport.id, id))
  return job!
}

async function runImport(body: unknown): Promise<number> {
  const jobId = await createImportJob(organismeCertificateur.id)
  const { errors, validItem } = await collectValidationResult(body, { organismeCertificateur }, jobId)
  expect(errors).toEqual([])
  await processFullJob(jobId, validItem!)
  return jobId
}

beforeEach(() => {
  vi.mocked(fetchOperatorByNumeroBio).mockResolvedValue(
    buildOperator({
      numeroBio: '99999',
      isProduction: true,
      organismeCertificateur: { id: 1, nom: 'Ecocert France', numeroClient: '100012' }
    })
  )
})

describe("pipeline d'import API", () => {
  test('crée le parcellaire, ses parcelles et ses cultures, et termine le job en VALID', async () => {
    const jobId = await runImport(payload())

    const records = await db.select().from(parcellaires).where(eq(parcellaires.numeroBio, 99999))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      ocId: 1,
      auditDate: '2026-04-27',
      anneeReferenceControle: 2026,
      certificationEtat: 'CERTIFIED'
    })

    const recordParcelles = await db.select().from(parcelles).where(eq(parcelles.recordId, records[0]!.recordId))
    expect(recordParcelles.map(({ id }) => id)).toEqual(['45742'])
    expect(recordParcelles[0]).toMatchObject({
      conversionNiveau: 'AB',
      engagementDate: '2023-04-27'
    })

    const cultures = await db.select().from(parcelleCultures).where(eq(parcelleCultures.recordId, records[0]!.recordId))
    expect(cultures).toHaveLength(1)
    expect(cultures[0]).toMatchObject({ parcelleId: '45742', cpf: '01.92' })

    expect(await findJob(jobId)).toMatchObject({
      status: 'DONE',
      statutJob: 'VALID',
      etat: 'CREATED',
      numeroBio: '99999',
      numeroClient: '100012',
      auditDate: '2026-04-27',
      resultJob: expect.objectContaining({
        errors: [],
        numeroBioValid: [{ numeroBio: '99999', nbParcelles: 1 }]
      })
    })
  })

  test("conserve le payload reçu pour l'historique", async () => {
    const jobId = await runImport(payload())

    const [stored] = await db
      .select()
      .from(parcellaireImportPayload)
      .where(eq(parcellaireImportPayload.importId, jobId))
    expect(stored?.payload).toMatchObject({ numeroBio: '99999', dateAudit: '2026-04-27' })
  })

  test("met à jour le parcellaire existant au lieu d'en créer un second pour la même date d'audit", async () => {
    await runImport(payload())
    const secondJob = await runImport(
      payload({
        parcelles: [
          {
            id: '45742',
            dateEngagement: '2023-04-27',
            etatProduction: 'AB',
            geom,
            culture: [{ codeCPF: '01.11.12', quantite: 100, unite: '%' }]
          }
        ]
      })
    )

    const records = await db.select().from(parcellaires).where(eq(parcellaires.numeroBio, 99999))
    expect(records).toHaveLength(1)
    const cultures = await db.select().from(parcelleCultures).where(eq(parcelleCultures.recordId, records[0]!.recordId))
    expect(cultures.map(({ cpf }) => cpf)).toEqual(['01.11.12'])
    expect(await findJob(secondJob)).toMatchObject({
      status: 'DONE',
      statutJob: 'VALID',
      etat: 'UPDATED'
    })
  })

  test('rejette un payload mal formé sans créer de parcellaire, en conservant le payload', async () => {
    const jobId = await createImportJob(organismeCertificateur.id)

    const { errors, validItem } = await collectValidationResult(
      { numeroBio: '99999' },
      { organismeCertificateur },
      jobId
    )

    expect(validItem).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every(({ code }) => code === 'INVALID_FORMAT')).toBe(true)
    expect(errors.map(({ message }) => message).join(' ')).toMatch(/champ parcelles incorrect/)
    expect(await db.select().from(parcellaires).where(eq(parcellaires.numeroBio, 99999))).toEqual([])
    const [stored] = await db
      .select()
      .from(parcellaireImportPayload)
      .where(eq(parcellaireImportPayload.importId, jobId))
    expect(stored?.payload).toEqual({ numeroBio: '99999' })
  })

  test("passe le job en ERROR sans rien écrire quand l'enregistrement échoue", async () => {
    const jobId = await createImportJob(organismeCertificateur.id)
    const { validItem } = await collectValidationResult(payload(), { organismeCertificateur }, jobId)
    validItem!.record.oc_id = 'x'.repeat(100) as never

    await processFullJob(jobId, validItem!)

    expect(await findJob(jobId)).toMatchObject({
      status: 'ERROR',
      resultJob: expect.objectContaining({ message: expect.any(String) })
    })
    expect(await db.select().from(parcellaires).where(eq(parcellaires.numeroBio, 99999))).toEqual([])
  })

  test("journalise un avertissement quand une géométrie invalide est corrigée à l'import", async () => {
    const epine =
      '[[[4.870,44.250],[4.871,44.250],[4.871,44.251],[4.8705,44.251],[4.8705,44.2515],[4.8705,44.251],[4.870,44.251],[4.870,44.250]]]'
    const jobId = await runImport(
      payload({
        parcelles: [
          {
            id: '45742',
            dateEngagement: '2023-04-27',
            etatProduction: 'AB',
            geom: epine,
            culture: [{ codeCPF: '01.92', quantite: 25, unite: '%' }]
          }
        ]
      })
    )

    const logs = await db.select().from(parcellaireImportLogs).where(eq(parcellaireImportLogs.importId, jobId))
    expect(logs).toEqual([
      expect.objectContaining({
        type: 'warning',
        code: 'GEOM_CORRECTED',
        numeroBio: '99999',
        message: 'Ces parcelles ont été corrigées : 45742'
      })
    ])
    expect(await findJob(jobId)).toMatchObject({ status: 'DONE', statutJob: 'VALID' })
  })

  test('importe un polygone en papillon non corrigeable sans perte, avec sa commune et un avertissement', async () => {
    const papillon = '[[[4.874,44.2559],[4.8736,44.2550],[4.874,44.2550],[4.8736,44.2559],[4.874,44.2559]]]'
    const jobId = await runImport(
      payload({
        parcelles: [
          {
            id: '45742',
            dateEngagement: '2023-04-27',
            etatProduction: 'AB',
            geom: papillon,
            culture: [{ codeCPF: '01.92', quantite: 25, unite: '%' }]
          }
        ]
      })
    )

    expect(await findJob(jobId)).toMatchObject({ status: 'DONE', statutJob: 'VALID' })
    const [record] = await db.select().from(parcellaires).where(eq(parcellaires.numeroBio, 99999))
    const [parcelle] = await db.select().from(parcelles).where(eq(parcelles.recordId, record!.recordId))
    expect(parcelle).toMatchObject({ statutImportGeom: 'ACCEPTE_NON_CORRIGE', etranger: false })
    expect(parcelle!.commune).toMatch(/^\d{5}$/)
    const logs = await db.select().from(parcellaireImportLogs).where(eq(parcellaireImportLogs.importId, jobId))
    expect(logs).toEqual([
      expect.objectContaining({
        type: 'warning',
        code: 'GEOM_INVALID_NOT_CORRECTED',
        message: "Ces parcelles n'ont pas été corrigées mais sont invalides : 45742"
      })
    ])
  })

  test.each([
    ['réduit à un point', '[[[4.87,44.25],[4.87,44.25],[4.87,44.25],[4.87,44.25]]]'],
    ['réduit à une ligne', '[[[4.87,44.25],[4.871,44.25],[4.87,44.25],[4.87,44.25]]]']
  ])("rejette l'import d'une parcelle dont le contour est %s, sans créer de parcellaire", async (_, geom) => {
    const jobId = await runImport(
      payload({
        parcelles: [
          {
            id: '45742',
            dateEngagement: '2023-04-27',
            etatProduction: 'AB',
            geom,
            culture: [{ codeCPF: '01.92', quantite: 25, unite: '%' }]
          }
        ]
      })
    )

    expect(await findJob(jobId)).toMatchObject({
      status: 'DONE',
      statutJob: 'REJECTED',
      resultJob: expect.objectContaining({
        errors: [
          expect.objectContaining({
            numeroBio: '99999',
            message: "Une géométrie n'est pas corrigeable (45742)"
          })
        ]
      })
    })
    expect(await db.select().from(parcellaires).where(eq(parcellaires.numeroBio, 99999))).toEqual([])
  })
})
