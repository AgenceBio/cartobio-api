import * as exportPdf from '../../../src/modules/exports/exports.service.js'
import * as generatePdfContent from '../../../src/modules/exports/pdf-content.js'
import * as utils from '../../../src/modules/exports/pdf-utils.js'
import * as repository from '../../../src/modules/exports/exports.repository.js'
import config from '../../../src/config/env.js'
import { get } from '../../got-mock.js'
import agencebioOperator from '../../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }
import parcellesJSON from '../../fixtures/providers/parcelles.json' with { type: 'json' }
import { randomUUID } from 'crypto'
import { AttestationsProductionsStatus, AttestationsProductionsType } from '@agencebio/cartobio-types'
import fs from 'fs'
import { asPdfDocument, buildCulture, buildPdfParcelle } from '../../factories.js'
import type { PdfParcelle, PdfRecord } from '../../../src/modules/exports/exports.types.js'

const parcelles = parcellesJSON.map((p) =>
  buildPdfParcelle({
    id: p.id,
    name: 'test',
    commune: p.commune,
    conversion_niveau: p.conversion_niveau as PdfParcelle['conversion_niveau'],
    engagement_date: p.engagement_date,
    nbilot: p.numero_ilot_pac,
    nbp: p.numero_parcelle_pac,
    cultures: p.cultures.map(({ CPF, variete }) => buildCulture({ CPF, variete }))
  })
)
const pdfRecord = agencebioOperator as unknown as PdfRecord
const generatedPdf = () =>
  asPdfDocument({ save: vi.fn().mockReturnValue('save'), saveAsBase64: vi.fn().mockReturnValue('save-as-base-64') })

vi.mock('../../../src/modules/exports/pdf-utils.js', () => ({
  getAllParcelles: vi.fn()
}))

vi.mock('../../../src/modules/exports/pdf-content.js', () => ({
  createPdfContent: vi.fn()
}))

vi.mock('../../../src/modules/exports/exports.repository.js', () => ({
  updateAttestationsProductions: vi.fn(),
  findValidAttestationProduction: vi.fn(),
  findPdfRecord: vi.fn()
}))

describe('Generation du PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(config, 'get').mockReturnValue('/tmp')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('on jette une exception si aucune parcelle', async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue(null)
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles).mockResolvedValueOnce([])
    const UUID = randomUUID()
    let hasTrown = false
    try {
      const gen = exportPdf.generatePDF('123', UUID)
      await gen.next()
    } catch (e) {
      console.error(e)
      hasTrown = true
    }

    expect(hasTrown).toEqual(true)

    expect(repository.findValidAttestationProduction).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsType.COMPLET
    )
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsStatus.STARTED,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(repository.findPdfRecord).toHaveBeenNthCalledWith(1, UUID)
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      2,
      UUID,
      AttestationsProductionsStatus.ERROR,
      AttestationsProductionsType.COMPLET,
      null
    )

    expect(repository.findValidAttestationProduction).toHaveBeenCalledTimes(1)
    expect(repository.updateAttestationsProductions).toHaveBeenCalledTimes(2)
    expect(repository.findPdfRecord).toHaveBeenCalledTimes(1)
  })

  it('on jette une exception si parcelle sans culture', async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue(null)
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    const tmpParcelles = parcelles.map((p) => ({ ...p }))

    tmpParcelles[0]!.cultures = [buildCulture({ CPF: '' })]
    vi.mocked(utils.getAllParcelles).mockResolvedValueOnce(tmpParcelles)
    const UUID = randomUUID()
    let hasTrown = false
    try {
      const gen = exportPdf.generatePDF('123', UUID)
      await gen.next()
    } catch (e) {
      console.error(e)
      hasTrown = true
    }

    expect(hasTrown).toEqual(true)

    expect(repository.findValidAttestationProduction).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsType.COMPLET
    )
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsStatus.STARTED,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(repository.findPdfRecord).toHaveBeenNthCalledWith(1, UUID)
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      2,
      UUID,
      AttestationsProductionsStatus.ERROR,
      AttestationsProductionsType.COMPLET,
      null
    )

    expect(repository.findValidAttestationProduction).toHaveBeenCalledTimes(1)
    expect(repository.updateAttestationsProductions).toHaveBeenCalledTimes(2)
    expect(repository.findPdfRecord).toHaveBeenCalledTimes(1)
  })

  it("on stock en base les resultat en cas d'exception", async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue(null)
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })

    vi.mocked(utils.getAllParcelles).mockResolvedValueOnce(parcelles)
    vi.mocked(generatePdfContent.createPdfContent).mockImplementation(() => {
      throw new Error('TEST')
    })
    const UUID = randomUUID()
    let hasTrown = false
    const gen = exportPdf.generatePDF('123', UUID)

    try {
      await gen.next()
      await gen.next()
    } catch (e) {
      console.error(e)
      hasTrown = true
    }

    expect(hasTrown).toEqual(true)

    expect(repository.findValidAttestationProduction).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsType.COMPLET
    )
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsStatus.STARTED,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(repository.findPdfRecord).toHaveBeenNthCalledWith(1, UUID)
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      2,
      UUID,
      AttestationsProductionsStatus.ERROR,
      AttestationsProductionsType.COMPLET,
      null
    )

    expect(repository.findValidAttestationProduction).toHaveBeenCalledTimes(1)
    expect(repository.updateAttestationsProductions).toHaveBeenCalledTimes(2)
    expect(repository.findPdfRecord).toHaveBeenCalledTimes(1)
  })

  it('on stock en base les resultat en cas de succès', async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue(null)
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles).mockResolvedValueOnce(parcelles)

    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])
    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID)

    const count = (await gen.next()).value
    expect(count).toEqual(3)
    const res = (await gen.next()).value

    expect(repository.findValidAttestationProduction).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsType.COMPLET
    )
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsStatus.STARTED,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(repository.findPdfRecord).toHaveBeenNthCalledWith(1, UUID)
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      2,
      UUID,
      AttestationsProductionsStatus.GENERATED,
      AttestationsProductionsType.COMPLET,
      expect.stringContaining(UUID)
    )

    expect(repository.findValidAttestationProduction).toHaveBeenCalledTimes(1)
    expect(repository.updateAttestationsProductions).toHaveBeenCalledTimes(2)
    expect(repository.findPdfRecord).toHaveBeenCalledTimes(1)

    expect(res).toEqual('save-as-base-64')
  })

  it('on ne regenere pas le pdf si il existe deja', async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue({ path: 'test' })
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles).mockResolvedValueOnce(parcelles)

    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('test-file')

    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID)

    const count = (await gen.next()).value
    expect(count).toEqual(0)
    const res = (await gen.next()).value

    expect(repository.findValidAttestationProduction).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsType.COMPLET
    )

    expect(repository.findValidAttestationProduction).toHaveBeenCalledTimes(1)
    expect(repository.updateAttestationsProductions).toHaveBeenCalledTimes(0)
    expect(repository.findPdfRecord).toHaveBeenCalledTimes(0)

    expect(res).toEqual('test-file')
  })

  it('on regenere le pdf si le boolean force est a true', async () => {
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles).mockResolvedValueOnce(parcelles)

    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])

    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID, true)

    const count = (await gen.next()).value
    expect(count).toEqual(3)
    const res = (await gen.next()).value

    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsStatus.STARTED,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(repository.findPdfRecord).toHaveBeenNthCalledWith(1, UUID)
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      2,
      UUID,
      AttestationsProductionsStatus.GENERATED,
      AttestationsProductionsType.COMPLET,
      expect.stringContaining(UUID)
    )

    expect(repository.findValidAttestationProduction).toHaveBeenCalledTimes(0)
    expect(repository.updateAttestationsProductions).toHaveBeenCalledTimes(2)
    expect(repository.findPdfRecord).toHaveBeenCalledTimes(1)

    expect(res).toEqual('save-as-base-64')
  })

  it("regenere le pdf si le fichier n'existe pas malgré la ligne en BDD", async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue({ path: 'test' })
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles).mockResolvedValueOnce(parcelles)

    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('Erreur de test readFile'))

    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID)

    const regenerationCount = (await gen.next()).value
    expect(regenerationCount).toEqual(3)
    const res = (await gen.next()).value

    expect(repository.findValidAttestationProduction).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsType.COMPLET
    )
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      1,
      UUID,
      AttestationsProductionsStatus.STARTED,
      AttestationsProductionsType.COMPLET,
      null
    )
    expect(repository.findPdfRecord).toHaveBeenNthCalledWith(1, UUID)
    expect(repository.updateAttestationsProductions).toHaveBeenNthCalledWith(
      2,
      UUID,
      AttestationsProductionsStatus.GENERATED,
      AttestationsProductionsType.COMPLET,
      expect.stringContaining(UUID)
    )

    expect(repository.findValidAttestationProduction).toHaveBeenCalledTimes(1)
    expect(repository.updateAttestationsProductions).toHaveBeenCalledTimes(2)
    expect(repository.findPdfRecord).toHaveBeenCalledTimes(1)

    expect(res).toEqual('save-as-base-64')
  })

  it('libère le verrou après une régénération due à un fichier absent', async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue({ path: 'test' })
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles).mockResolvedValue(parcelles)
    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('Erreur de test readFile'))

    const UUID = randomUUID()
    for (let i = 0; i < 2; i++) {
      const gen = exportPdf.generatePDF('123', UUID)
      expect((await gen.next()).value).toEqual(3)
      expect((await gen.next()).value).toEqual('save-as-base-64')
    }
  })

  it('refuse une seconde génération simultanée du même parcellaire', async () => {
    vi.mocked(repository.findValidAttestationProduction).mockResolvedValue(null)
    vi.mocked(repository.findPdfRecord).mockResolvedValue(pdfRecord)
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles).mockResolvedValue(parcelles)
    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)

    const UUID = randomUUID()
    const first = exportPdf.generatePDF('123', UUID)
    expect((await first.next()).value).toEqual(3)

    await expect(exportPdf.generatePDF('123', UUID).next()).rejects.toThrow('déjà en cours')

    expect((await first.next()).value).toEqual('save-as-base-64')
  })
})
