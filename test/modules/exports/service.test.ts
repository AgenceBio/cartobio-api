import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { AttestationsProductionsStatus, AttestationsProductionsType } from '@agencebio/cartobio-types'
import type { PDFDocument } from 'pdf-lib'
import config from '../../../src/config/env.js'
import * as repository from '../../../src/modules/exports/exports.repository.js'
import { getAllParcelles } from '../../../src/modules/exports/pdf-utils.js'
import { createPdfContent } from '../../../src/modules/exports/pdf-content.js'
import { fetchOperatorByNumeroBio } from '../../../src/clients/agence-bio.client.js'
import { findControlBodyOperators } from '../../../src/modules/operators/operators.service.js'
import { deleteRecordAttestations, exportDataOcId, generatePDF } from '../../../src/modules/exports/exports.service.js'
import type { ExportRow, PdfRecord } from '../../../src/modules/exports/exports.types.js'
import { buildCulture, buildOperator, buildPdfParcelle } from '../../factories.js'

vi.mock('../../../src/modules/exports/exports.repository.js')
vi.mock('../../../src/modules/exports/pdf-utils.js')
vi.mock('../../../src/modules/exports/pdf-content.js')
vi.mock('../../../src/clients/agence-bio.client.js')
vi.mock('../../../src/modules/operators/operators.service.js')

const mockedRepo = vi.mocked(repository)
const RECORD = 'record-1'
const validParcelle = buildPdfParcelle({ name: 'Champ', cultures: [buildCulture()] })
const pdf = (content: string) =>
  ({
    save: vi.fn().mockResolvedValue(Buffer.from(content)),
    saveAsBase64: vi.fn().mockResolvedValue(Buffer.from(content).toString('base64'))
  }) as unknown as PDFDocument

async function run<T>(gen: AsyncGenerator<number, T>): Promise<{ yielded: number[]; result: T }> {
  const yielded: number[] = []
  for (;;) {
    const { value, done } = await gen.next()
    if (done) return { yielded, result: value }
    yielded.push(value)
  }
}

let directory: string

beforeEach(() => {
  vi.clearAllMocks()
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cartobio-pdf-'))
  const get = config.get.bind(config)
  vi.spyOn(config, 'get').mockImplementation(((key: string) =>
    key === 'attestationsProductions.directory' ? directory : get(key as never)) as typeof config.get)
  mockedRepo.findValidAttestationProduction.mockResolvedValue(null)
  mockedRepo.findPdfRecord.mockResolvedValue({
    annee_reference_controle: 2025
  } as unknown as PdfRecord)
  vi.mocked(fetchOperatorByNumeroBio).mockResolvedValue(buildOperator({ numeroBio: '99999' }))
  vi.mocked(getAllParcelles).mockResolvedValue([validParcelle])
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('generatePDF', () => {
  test('génère, enregistre et référence une attestation complète', async () => {
    vi.mocked(createPdfContent).mockResolvedValue([pdf('complet')])

    const { yielded, result } = await run(generatePDF('99999', RECORD))

    expect(yielded).toEqual([1])
    expect(result).toBe(Buffer.from('complet').toString('base64'))
    const file = path.join(directory, `${RECORD}_complet_0.pdf`)
    expect(fs.readFileSync(file, 'utf8')).toBe('complet')
    expect(mockedRepo.updateAttestationsProductions).toHaveBeenCalledWith(
      RECORD,
      AttestationsProductionsStatus.STARTED,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(mockedRepo.updateAttestationsProductions).toHaveBeenLastCalledWith(
      RECORD,
      AttestationsProductionsStatus.GENERATED,
      AttestationsProductionsType.COMPLET,
      file
    )
    expect(getAllParcelles).toHaveBeenCalledWith(RECORD, false)
  })

  test('retourne une attestation déjà générée sans la régénérer', async () => {
    const file = path.join(directory, 'existant.pdf')
    fs.writeFileSync(file, 'déjà là')
    mockedRepo.findValidAttestationProduction.mockResolvedValue({ path: file } as never)

    const { yielded, result } = await run(generatePDF('99999', RECORD))

    expect(yielded).toEqual([0])
    expect(result).toBe(Buffer.from('déjà là').toString('base64'))
    expect(createPdfContent).not.toHaveBeenCalled()
  })

  test("régénère si le fichier de l'attestation existante a disparu", async () => {
    mockedRepo.findValidAttestationProduction.mockResolvedValue({
      path: path.join(directory, 'absent.pdf')
    } as never)
    vi.mocked(createPdfContent).mockResolvedValue([pdf('nouveau')])

    const { result } = await run(generatePDF('99999', RECORD))

    expect(result).toBe(Buffer.from('nouveau').toString('base64'))
  })

  test('ignore une attestation existante quand la régénération est forcée', async () => {
    vi.mocked(createPdfContent).mockResolvedValue([pdf('forcé')])

    await run(generatePDF('99999', RECORD, true))

    expect(mockedRepo.findValidAttestationProduction).not.toHaveBeenCalled()
    expect(createPdfContent).toHaveBeenCalled()
  })

  test("archive les attestations PAC dans un zip nommé avec l'année et le numéro bio", async () => {
    vi.mocked(createPdfContent).mockResolvedValue([pdf('details'), pdf('complet')])

    const { result } = await run(generatePDF('99999', RECORD, false, false, true))

    const entries = new AdmZip(Buffer.from(result, 'base64')).getEntries()
    expect(entries.map(({ entryName }) => entryName)).toEqual([
      'cartobio_attestation_PAC_2025_99999.pdf',
      'cartobio_liste_PAC_2025_99999.pdf'
    ])
    expect(getAllParcelles).toHaveBeenCalledWith(RECORD, true)
    expect(mockedRepo.updateAttestationsProductions).toHaveBeenCalledWith(
      RECORD,
      AttestationsProductionsStatus.GENERATED,
      AttestationsProductionsType.PACCOMPLET,
      path.join(directory, `${RECORD}_PAC_1.pdf`)
    )
  })

  test.each([
    ['sans parcelle', [], "Aucune parcelle trouvée pour l'opérateur record-1"],
    [
      'avec une parcelle sans culture',
      [buildPdfParcelle({ name: 'Champ', cultures: [] })],
      "Culture manquante, impossible de générer l'attestation du parcellaire"
    ],
    [
      'avec une culture sans code CPF',
      [buildPdfParcelle({ name: 'Champ', cultures: [buildCulture({ CPF: '' })] })],
      "Culture manquante, impossible de générer l'attestation du parcellaire"
    ],
    [
      'avec une parcelle sans nom ni référence',
      [buildPdfParcelle({ cultures: [buildCulture()], refcad: ['', null] as never })],
      "Nom manquant de parcelle, impossible de générer l'attestation du parcellaire"
    ]
  ])('refuse un parcellaire %s et marque la génération en erreur', async (_, parcelles, message) => {
    vi.mocked(getAllParcelles).mockResolvedValue(parcelles)

    await expect(run(generatePDF('99999', RECORD))).rejects.toMatchObject({
      statusCode: 400,
      message
    })
    expect(mockedRepo.updateAttestationsProductions).toHaveBeenLastCalledWith(
      RECORD,
      AttestationsProductionsStatus.ERROR,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(createPdfContent).not.toHaveBeenCalled()
  })

  test.each([
    ['un numéro PAC', { nbilot: '1', nbp: '2' }],
    ['une référence cadastrale', { refcad: ['75056000AB0123'] }]
  ])('accepte une parcelle sans nom identifiée par %s', async (_, overrides) => {
    vi.mocked(getAllParcelles).mockResolvedValue([buildPdfParcelle({ cultures: [buildCulture()], ...overrides })])
    vi.mocked(createPdfContent).mockResolvedValue([pdf('ok')])

    await expect(run(generatePDF('99999', RECORD))).resolves.toBeDefined()
  })

  test('retourne une 404 pour un parcellaire introuvable', async () => {
    mockedRepo.findPdfRecord.mockResolvedValue(null)

    await expect(run(generatePDF('99999', RECORD))).rejects.toMatchObject({ statusCode: 404 })
  })

  test('masque les erreurs internes', async () => {
    vi.mocked(createPdfContent).mockRejectedValue(new Error('puppeteer crash'))

    await expect(run(generatePDF('99999', RECORD))).rejects.toThrow(
      "Une erreur s'est produite, impossible de générer l'attestation du parcellaire"
    )
  })

  test('refuse une seconde génération simultanée du même parcellaire, puis libère le verrou', async () => {
    let release!: () => void
    vi.mocked(createPdfContent).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([pdf('lent')])))
    )
    const first = generatePDF('99999', RECORD)
    await first.next()

    await expect(run(generatePDF('99999', RECORD))).rejects.toMatchObject({
      statusCode: 400,
      message: "Une génération de l'attestation est déjà en cours pour ce parcellaire."
    })

    const pending = first.next()
    await vi.waitFor(() => expect(release).toBeDefined())
    release()
    await pending

    vi.mocked(createPdfContent).mockResolvedValue([pdf('ensuite')])
    await expect(run(generatePDF('99999', RECORD))).resolves.toBeDefined()
  })
})

describe('deleteRecordAttestations', () => {
  test('supprime uniquement les PDF du parcellaire', async () => {
    for (const file of [`${RECORD}_complet_0.pdf`, `${RECORD}_PAC_0.PDF`, `${RECORD}.txt`, 'autre_complet_0.pdf']) {
      fs.writeFileSync(path.join(directory, file), '')
    }

    await deleteRecordAttestations(RECORD)

    expect(fs.readdirSync(directory).sort()).toEqual(['autre_complet_0.pdf', `${RECORD}.txt`])
    expect(mockedRepo.deleteAttestationsProductions).toHaveBeenCalledWith(RECORD)
  })
})

describe('exportDataOcId', () => {
  test("complète les lignes avec les données de l'opérateur", async () => {
    vi.mocked(findControlBodyOperators).mockResolvedValue([
      {
        ...buildOperator({
          numeroBio: '20',
          nom: 'B',
          siret: '2',
          codePostal: '26000',
          commune: 'Valence'
        }),
        notifications: { numeroClient: 'C-20' } as never,
        epingle: false
      },
      { ...buildOperator({ numeroBio: '10', nom: 'A' }), epingle: false }
    ])
    mockedRepo.findExportRows.mockResolvedValue([
      { record_id: 'r20', numerobio: 20 },
      { record_id: 'r10', numerobio: 10 }
    ] as unknown as ExportRow[])

    const rows = await exportDataOcId(999, { input: 'x', filterForSearch: {} }, 1)

    expect(findControlBodyOperators).toHaveBeenCalledWith({
      ocId: 999,
      userId: 1,
      input: 'x',
      filter: {}
    })
    expect(mockedRepo.findExportRows).toHaveBeenCalledWith(999, [10, 20])
    expect(rows).toEqual([
      expect.objectContaining({
        record_id: 'r20',
        numeroclient: 'C-20',
        siret: '2',
        raisonSociale: 'B',
        codePostal: '26000',
        commune: 'Valence'
      }),
      expect.objectContaining({ record_id: 'r10', numeroclient: '', raisonSociale: 'A' })
    ])
  })

  test("n'interroge pas la base sans opérateur", async () => {
    vi.mocked(findControlBodyOperators).mockResolvedValue([])

    expect(await exportDataOcId(999, { input: '', filterForSearch: {} }, 1)).toEqual([])
    expect(mockedRepo.findExportRows).not.toHaveBeenCalled()
  })
})
