import * as generatePdf from '../../../src/modules/exports/pdf-content.js'
import * as utils from '../../../src/modules/exports/pdf-utils.js'
import puppeteer from 'puppeteer'
import type { Mock } from 'vitest'
import type { Page } from 'puppeteer'
import type { PDFDocument } from 'pdf-lib'
import type { PdfRecord } from '../../../src/modules/exports/exports.types.js'
import { buildCulture, buildOperator, buildPdfParcelle } from '../../factories.js'

vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }))

vi.mock('../../../src/modules/exports/pdf-utils.js', async (importOriginal) => ({
  formatDate: (await importOriginal<typeof import('../../../src/modules/exports/pdf-utils.js')>()).formatDate,
  formatRefCad: (await importOriginal<typeof import('../../../src/modules/exports/pdf-utils.js')>()).formatRefCad,
  restrictNetwork: vi.fn(),
  mergeAndAddFooter: vi.fn(),
  calculateGlobalBoundingBox: vi.fn(),
  getOptimalZoom: vi.fn(),
  drawAllParcellesOnMap: vi.fn(),
  drawParcelleHighlightOnMap: vi.fn(),
  getAllParcelles: vi.fn(),
  launchStyleTab: vi.fn().mockImplementation(() => {
    throw new Error('Test')
  })
}))

describe('generateOperatorMapImages', () => {
  const mockPage = {} as Page
  const sampleParcelles = [
    buildPdfParcelle({ id: 'parcelle-1', minx: 1, miny: 1, maxx: 3, maxy: 3, centerx: 2, centery: 2 }),
    buildPdfParcelle({ id: 'parcelle-2', minx: 2, miny: 2, maxx: 4, maxy: 4, centerx: 3, centery: 3 })
  ]
  const globalBbox = { minx: 0, miny: 0, maxx: 10, maxy: 10, centerx: 5, centery: 5, width: 10, height: 10 }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('génère les images correctement pour les parcelles', async () => {
    vi.mocked(utils.calculateGlobalBoundingBox).mockReturnValue(globalBbox)

    vi.mocked(utils.getOptimalZoom).mockReturnValue(12)

    vi.mocked(utils.drawAllParcellesOnMap).mockResolvedValue({ buffer: 'global-image' })

    vi.mocked(utils.drawParcelleHighlightOnMap).mockResolvedValue({ buffer: 'parcelle-image' })

    const result = await generatePdf.generateOperatorMapImages(sampleParcelles, mockPage)

    expect(utils.calculateGlobalBoundingBox).toHaveBeenCalledWith(sampleParcelles)
    expect(utils.drawAllParcellesOnMap).toHaveBeenCalled()
    expect(utils.drawParcelleHighlightOnMap).toHaveBeenCalledTimes(2)

    expect(result.global?.buffer).toBe('global-image')
    expect(result.parcelles).toHaveLength(2)
    expect(result.parcelles[0]!.id).toBe('parcelle-1')
    expect(result.parcelles[0]!.buffer).toBe('parcelle-image')
  })

  it('gère une erreur dans drawAllParcellesOnMap', async () => {
    vi.mocked(utils.calculateGlobalBoundingBox).mockReturnValue(globalBbox)

    vi.mocked(utils.getOptimalZoom).mockReturnValue(12)

    vi.mocked(utils.drawAllParcellesOnMap).mockResolvedValue({ error: 'some error' })

    const result = await generatePdf.generateOperatorMapImages(sampleParcelles, mockPage)

    expect(result.global).toBeNull()
    expect(result.parcelles).toEqual([])
  })

  it('ignore les parcelles avec erreur individuelle', async () => {
    vi.mocked(utils.calculateGlobalBoundingBox).mockReturnValue(globalBbox)

    vi.mocked(utils.getOptimalZoom).mockReturnValue(12)

    vi.mocked(utils.drawAllParcellesOnMap).mockResolvedValue({ buffer: 'global-image' })

    vi.mocked(utils.drawParcelleHighlightOnMap)
      .mockResolvedValueOnce({ buffer: 'parcelle-image-1' })
      .mockResolvedValueOnce({ error: 'error' })

    const result = await generatePdf.generateOperatorMapImages(sampleParcelles, mockPage)

    expect(result.parcelles).toHaveLength(1)
    expect(result.parcelles[0]!.id).toBe('parcelle-1')
  })
})

describe('createPdfContent', () => {
  let page: Record<string, Mock>
  let browser: Record<string, Mock>
  const operator = {
    ...buildOperator({ nom: 'Ferme <b>du</b> test', numeroBio: '99999' }),
    audit_date: '2025-03-01'
  } as unknown as Parameters<typeof generatePdf.createPdfContent>[3] & PdfRecord
  const parcelles = [
    buildPdfParcelle({
      id: 'c1',
      conversion_niveau: 'C1',
      name: 'Zone C1',
      superficie_totale_ha: 1,
      cultures: [buildCulture()]
    }),
    buildPdfParcelle({
      id: 'ab2',
      conversion_niveau: 'AB',
      nbilot: '10',
      nbp: '1',
      superficie_totale_ha: 1.25,
      cultures: [buildCulture()]
    }),
    buildPdfParcelle({
      id: 'ab1',
      conversion_niveau: 'AB',
      nbilot: '2',
      nbp: '3',
      superficie_totale_ha: 1.25,
      cultures: [buildCulture()]
    }),
    buildPdfParcelle({
      id: 'conv',
      conversion_niveau: 'CONV',
      name: '<script>alert(1)</script>',
      superficie_totale_ha: 0.5,
      cultures: [buildCulture({ CPF: 'ACT.Prod.Inc' })]
    })
  ]
  const html = () => page.setContent!.mock.calls.map(([content]) => String(content))

  beforeEach(() => {
    vi.clearAllMocks()
    page = {
      setJavaScriptEnabled: vi.fn(),
      setContent: vi.fn(),
      evaluate: vi.fn(),
      pdf: vi.fn(),
      close: vi.fn()
    }
    browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() }
    vi.mocked(puppeteer.launch).mockResolvedValue(browser as never)
    vi.mocked(utils.launchStyleTab).mockResolvedValue({} as Page)
    vi.mocked(utils.calculateGlobalBoundingBox).mockReturnValue({
      minx: 0,
      miny: 0,
      maxx: 1,
      maxy: 1,
      centerx: 0.5,
      centery: 0.5,
      width: 1,
      height: 1
    })
    vi.mocked(utils.getOptimalZoom).mockReturnValue(12)
    vi.mocked(utils.drawAllParcellesOnMap).mockResolvedValue({ buffer: 'global-image' })
    vi.mocked(utils.drawParcelleHighlightOnMap).mockResolvedValue({ buffer: 'parcelle-image' })
    vi.mocked(utils.mergeAndAddFooter).mockImplementation(async (paths) => ({ paths }) as unknown as PDFDocument)
  })

  test('produit le récapitulatif trié par niveau de conversion avec les totaux', async () => {
    const pdfs = await generatePdf.createPdfContent('99999', 'record', parcelles, operator, false)

    expect(pdfs).toHaveLength(1)
    expect(utils.mergeAndAddFooter).toHaveBeenCalledWith(
      [expect.stringMatching(/99999-record-\d+-1\.pdf$/)],
      operator.nom,
      false
    )
    const [details, resume] = html()
    expect(details!.indexOf('Ilot 2 parcelle 3')).toBeLessThan(details!.indexOf('Ilot 10 parcelle 1'))
    expect(details!.indexOf('Ilot 10 parcelle 1')).toBeLessThan(details!.indexOf('Parcelle Zone C1'))
    expect(resume).toContain('Niveau de conversion AB')
    expect(resume!.indexOf('Niveau de conversion AB')).toBeLessThan(resume!.indexOf('Niveau de conversion C1'))
    expect(resume!.indexOf('Niveau de conversion C1')).toBeLessThan(
      resume!.indexOf('Niveau de conversion conventionnel')
    )
    expect(resume!.replace(/\s+/g, ' ')).toContain(
      'Surface totale de l\'exploitation : </td> <td class="text-right"> 4,00 ha'
    )
    expect(resume).toContain('Culture non renseignée sur votre parcelle')
    expect(browser.close).toHaveBeenCalled()
  })

  test("échappe les données saisies par l'utilisateur", async () => {
    await generatePdf.createPdfContent('99999', 'record', parcelles, operator, false)

    const content = html().join('')
    expect(content).not.toContain('<script>alert(1)</script>')
    expect(content).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(content).not.toContain('Ferme <b>du</b> test')
  })

  test("produit l'attestation PAC détaillée puis la liste PAC", async () => {
    const pdfs = await generatePdf.createPdfContent('99999', 'record', parcelles, operator, true)

    expect(pdfs).toHaveLength(2)
    expect(
      vi
        .mocked(utils.mergeAndAddFooter)
        .mock.calls.map(([paths, , deleteAfter]) => [paths.map((p) => p.slice(-5)), deleteAfter])
    ).toEqual([
      [['1.pdf', '2.pdf'], false],
      [['1.pdf'], true]
    ])
  })

  test('échoue sans carte globale et ferme le navigateur', async () => {
    vi.mocked(utils.drawAllParcellesOnMap).mockResolvedValue({ error: 'timeout' })

    await expect(generatePdf.createPdfContent('99999', 'record', parcelles, operator, false)).rejects.toThrow(
      "La carte du parcellaire n'a pas pu être générée"
    )
    expect(browser.close).toHaveBeenCalled()
    expect(utils.mergeAndAddFooter).not.toHaveBeenCalled()
  })

  test("échoue si la carte d'une parcelle manque", async () => {
    vi.mocked(utils.drawParcelleHighlightOnMap).mockResolvedValueOnce({ error: 'timeout' })

    await expect(generatePdf.createPdfContent('99999', 'record', parcelles, operator, false)).rejects.toThrow(
      /Carte de la parcelle .* non générée/
    )
  })
})
