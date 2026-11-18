import type { Mock } from 'vitest'
import {
  getOptimalZoom,
  getAllParcelles,
  calculateGlobalBoundingBox,
  formatDate,
  launchStyleTab,
  drawParcelleHighlightOnMap,
  drawAllParcellesOnMap,
  mergeAndAddFooter
} from '../../../src/modules/exports/pdf-utils.js'
import fs from 'fs'
import path from 'path'
import pdflib from 'pdf-lib'
import { findPdfParcelles } from '../../../src/modules/exports/exports.repository.js'
import type { MapDrawOptions, PdfParcelle } from '../../../src/modules/exports/exports.types.js'
import { asBrowser, asPage, asPdfDocument, buildPdfParcelle } from '../../factories.js'

vi.mock('../../../src/modules/exports/exports.repository.js', () => ({
  findPdfParcelles: vi.fn()
}))

describe('getOptimalZoom', () => {
  test('calcul le zoom optimal', () => {
    const zoom = getOptimalZoom(100, 50, 800, 600)
    expect(typeof zoom).toBe('number')
    expect(zoom).toBeGreaterThanOrEqual(0)
    expect(zoom).toBeLessThanOrEqual(20)
  })
})

describe('calculateGlobalBoundingBox', () => {
  test('retourne null pour aucune parcelles', () => {
    expect(calculateGlobalBoundingBox([])).toBeNull()
  })

  test('fait le bon calcul', () => {
    const parcelles = [
      buildPdfParcelle({ minx: 1, miny: 2, maxx: 5, maxy: 6 }),
      buildPdfParcelle({ minx: 2, miny: 1, maxx: 6, maxy: 7 })
    ]
    const bbox = calculateGlobalBoundingBox(parcelles)
    expect(bbox).toEqual({
      minx: 1,
      miny: 1,
      maxx: 6,
      maxy: 7,
      centerx: 3.5,
      centery: 4,
      width: 5,
      height: 6
    })
  })
})

describe('formatDate', () => {
  it('formatter la date au format DD/MM/YYYY', () => {
    const dateStr = '2025-04-02'
    const formattedDate = formatDate(dateStr)
    expect(formattedDate).toBe('02/04/2025')
  })
})

describe('launchStyleTab', () => {
  let pageMock: Record<string, Mock>
  let browserMock: Record<string, Mock>

  beforeEach(() => {
    pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn()
    }

    browserMock = {
      newPage: vi.fn().mockResolvedValue(pageMock)
    }

    path.resolve = vi.fn().mockImplementation((...args) => args.join('/'))
    vi.spyOn(fs, 'readFile').mockImplementation(((_: unknown, __: unknown, cb: (error: null, data: string) => void) => {
      cb(null, JSON.stringify({ version: 8, sources: {}, layers: [] }))
    }) as unknown as typeof fs.readFile)
  })

  it('devrait charger la page avec le style', async () => {
    const page = await launchStyleTab(asBrowser(browserMock))
    expect(browserMock.newPage).toHaveBeenCalled()
    expect(pageMock.goto).toHaveBeenCalled()
    expect(pageMock.evaluate).toHaveBeenCalled()
    expect(page).toBe(pageMock)
  })

  it('devrait gérer une erreur lors du chargement', async () => {
    pageMock.goto!.mockRejectedValue(new Error('Page style'))

    await expect(launchStyleTab(asBrowser(browserMock))).rejects.toThrow(
      'Timeout lors du chargement de la page avec le style Page style'
    )
    expect(pageMock.close).toHaveBeenCalled()
  })
})

describe('drawAllParcellesOnMap', () => {
  let pageMock: Record<string, Mock>

  beforeEach(() => {
    pageMock = {
      setViewport: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
      screenshot: vi.fn().mockResolvedValue('fake-base64-image')
    }
  })

  const parcelles = [buildPdfParcelle({ id: '123' })]

  const options: MapDrawOptions = {
    width: 800,
    height: 600,
    center: [2, 48],
    zoom: 13,
    timeout: 5000
  }

  it('devrait retourner un buffer base64 si tout se passe bien', async () => {
    const result = await drawAllParcellesOnMap(asPage(pageMock), parcelles, options)

    expect(pageMock.setViewport).toHaveBeenCalledWith({ width: 800, height: 600 })
    expect(pageMock.waitForSelector).toHaveBeenCalled()
    expect(pageMock.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      parcelles,
      center: [2, 48],
      zoom: 13
    })
    expect(result).toEqual({ buffer: 'fake-base64-image' })
  })

  it('devrait retourner une erreur si page.evaluate renvoie une erreur', async () => {
    pageMock.evaluate!.mockResolvedValue('Erreur JS dans le navigateur')

    const result = await drawAllParcellesOnMap(asPage(pageMock), parcelles, options)
    expect(result).toEqual({ error: 'Erreur JS dans le navigateur' })
  })

  it('devrait retourner une erreur de timeout', async () => {
    pageMock.waitForFunction!.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Timeout'))

    const result = await drawAllParcellesOnMap(asPage(pageMock), parcelles, options)
    expect(result).toEqual({ error: 'Timeout exceeded (5000ms)' })
  })
})

describe('drawParcelleHighlightOnMap', () => {
  let pageMock: Record<string, Mock>

  beforeEach(() => {
    pageMock = {
      setViewport: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
      screenshot: vi.fn().mockResolvedValue('highlighted-img')
    }
  })

  const parcelles = [
    buildPdfParcelle({ id: '1' }),
    buildPdfParcelle({
      id: '2',
      geojson: JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
            [1, 1]
          ]
        ]
      })
    })
  ]

  const highlight = { ...parcelles[0]!, name: 'Test', nbilot: '12', nbp: '34' }

  const options: MapDrawOptions = {
    width: 800,
    height: 600,
    center: [2, 48],
    zoom: 13,
    timeout: 5000
  }

  it('retourne une image avec la parcelle en surbrillance', async () => {
    const result = await drawParcelleHighlightOnMap(asPage(pageMock), parcelles, highlight, options)
    expect(result).toEqual({ buffer: 'highlighted-img' })
    expect(pageMock.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      parcelles,
      parcelleHighlight: highlight,
      center: options.center,
      zoom: options.zoom
    })
  })

  it('retourne une erreur si evaluate échoue', async () => {
    pageMock.evaluate!.mockResolvedValue("Erreur dans l'éval")
    const result = await drawParcelleHighlightOnMap(asPage(pageMock), parcelles, highlight, options)
    expect(result).toEqual({ error: "Erreur dans l'éval" })
  })
})

vi.mock('pdf-lib')

vi.spyOn(fs, 'readFileSync').mockImplementation((path) => {
  return Buffer.from(`PDF data for ${path}`)
})
vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {})

describe('mergeAndAddFooter', () => {
  let mockMergedPdf: Record<string, Mock>
  let mockLoadedPdf: Record<string, Mock>
  let mockPage: Record<string, Mock>

  beforeEach(() => {
    mockPage = {
      getSize: vi.fn(() => ({ width: 100 })),
      drawText: vi.fn()
    }

    mockLoadedPdf = {
      getPageIndices: vi.fn(() => [0])
    }

    mockMergedPdf = {
      addPage: vi.fn(),
      copyPages: vi.fn().mockResolvedValue([mockPage])
    }
    vi.mocked(pdflib.PDFDocument.create).mockResolvedValue(asPdfDocument(mockMergedPdf))
    vi.mocked(pdflib.PDFDocument.load).mockResolvedValue(asPdfDocument(mockLoadedPdf))
  })

  it('devrait fusionner les PDFs et ajouter un pied de page', async () => {
    const pdfPaths = ['doc1.pdf', 'doc2.pdf']
    const name = 'TestName'

    const result = await mergeAndAddFooter(pdfPaths, name, true)

    expect(pdflib.PDFDocument.load).toHaveBeenCalledTimes(2)
    expect(mockMergedPdf.copyPages).toHaveBeenCalledTimes(2)
    expect(mockMergedPdf.addPage).toHaveBeenCalledTimes(2)
    expect(mockPage.drawText).toHaveBeenCalledWith('2', expect.objectContaining({ x: expect.any(Number), y: 20 }))
    expect(mockPage.drawText).toHaveBeenCalledWith('TestName', expect.objectContaining({ x: 38, y: 20 }))
    expect(fs.unlinkSync).toHaveBeenCalledWith('doc1.pdf')
    expect(fs.unlinkSync).toHaveBeenCalledWith('doc2.pdf')
    expect(result).toEqual(mockMergedPdf)
  })
})

describe('getAllParcelles', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('retourne les parcelles avec le geojson parsé', async () => {
    const mockRow = {
      id: 'p1',
      name: 'Parcelle 1',
      geojson:
        '{"type":"Polygon","coordinates":[[[4.979616538,47.353725228],[4.974457803,47.347718045],[4.979777749,47.346188835],[4.985742536,47.350994775],[4.979616538,47.353725228]]]}',
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
      centerX: 0.5,
      centerY: 0.5,
      superficie_totale_ha: 1.23,
      cultures: null,
      conversion_niveau: null,
      commune: '12345',
      communename: 'Ma commune',
      created: '2023-01-01',
      auditeur_notes: null,
      engagement_date: null,
      nbilot: '42',
      nbp: '123',
      refcad: 'AB001'
    }
    vi.mocked(findPdfParcelles).mockResolvedValueOnce([mockRow as unknown as PdfParcelle])
    const result = await getAllParcelles('some-record-id')
    expect(findPdfParcelles).toHaveBeenCalledWith('some-record-id', false)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'p1',
      geojson:
        '{"type":"Polygon","coordinates":[[[4.979616538,47.353725228],[4.974457803,47.347718045],[4.979777749,47.346188835],[4.985742536,47.350994775],[4.979616538,47.353725228]]]}',
      name: 'Parcelle 1',
      superficie_totale_ha: 1.23
    })
  })

  it("propage l'erreur de la base", async () => {
    vi.mocked(findPdfParcelles).mockRejectedValueOnce(new Error('DB down'))

    await expect(getAllParcelles('fail-id')).rejects.toThrow('DB down')
    expect(findPdfParcelles).toHaveBeenCalled()
  })
})
