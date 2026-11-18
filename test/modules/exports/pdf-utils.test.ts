import type { Mock } from 'vitest'
import {
  getOptimalZoom,
  getAllParcelles,
  calculateGlobalBoundingBox,
  formatDate,
  formatRefCad,
  launchStyleTab,
  restrictNetwork,
  drawParcelleHighlightOnMap,
  drawAllParcellesOnMap,
  mergeAndAddFooter
} from '../../../src/modules/exports/pdf-utils.js'
import fs from 'node:fs'
import pdflib from 'pdf-lib'
import { findPdfParcelles } from '../../../src/modules/exports/exports.repository.js'
import type { MapDrawOptions } from '../../../src/modules/exports/exports.types.js'
import { asBrowser, asPage, asPdfDocument, buildPdfParcelle } from '../../factories.js'

vi.mock('../../../src/modules/exports/exports.repository.js', () => ({
  findPdfParcelles: vi.fn()
}))

describe('getOptimalZoom', () => {
  test('calcule le zoom optimal selon l’axe le plus contraignant', () => {
    expect(getOptimalZoom(100, 50, 800, 600)).toBe(1)
    expect(getOptimalZoom(0.01, 0.01, 800, 600)).toBe(14)
    expect(getOptimalZoom(0.02, 0.001, 800, 600)).toBe(14)
  })

  test('gagne un niveau de zoom quand la fenêtre double de taille', () => {
    expect(getOptimalZoom(0.01, 0.01, 1600, 1200)).toBe(getOptimalZoom(0.01, 0.01, 800, 600) + 1)
  })

  test('plafonne le zoom à 20 pour une emprise nulle', () => {
    expect(getOptimalZoom(0, 0, 800, 600)).toBe(20)
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

describe('formatRefCad', () => {
  test('retire le code commune et sépare préfixe, section et numéro', () => {
    expect(formatRefCad('75056000AB0123')).toBe('000 AB 0123')
  })

  test('retourne le reste brut si le format est inattendu', () => {
    expect(formatRefCad('75056AB')).toBe('AB')
    expect(formatRefCad('7505')).toBe('')
  })
})

describe('restrictNetwork', () => {
  const intercept = async (url: string): Promise<Record<string, Mock>> => {
    const pageMock = { setRequestInterception: vi.fn().mockResolvedValue(undefined), on: vi.fn() }
    await restrictNetwork(asPage(pageMock))
    const request = { url: vi.fn(() => url), respond: vi.fn(), continue: vi.fn(), abort: vi.fn() }
    pageMock.on.mock.calls[0]![1](request)
    return request
  }

  test("active l'interception des requêtes", async () => {
    const pageMock = { setRequestInterception: vi.fn().mockResolvedValue(undefined), on: vi.fn() }
    await restrictNetwork(asPage(pageMock))
    expect(pageMock.setRequestInterception).toHaveBeenCalledWith(true)
    expect(pageMock.on).toHaveBeenCalledWith('request', expect.any(Function))
  })

  test('sert la page de carte locale', async () => {
    const request = await intercept('https://pdf.cartobio.invalid/map.html')
    expect(request.respond).toHaveBeenCalledWith(expect.objectContaining({ status: 200, contentType: 'text/html' }))
    expect(request.continue).not.toHaveBeenCalled()
  })

  test('ne sert que le nom de fichier des ressources maplibre', async () => {
    const request = await intercept('https://pdf.cartobio.invalid/maplibre-gl/../../../etc/passwd')
    expect(request.respond).not.toHaveBeenCalled()
    expect(request.abort).toHaveBeenCalled()
  })

  test.each([
    'https://openmaptiles.geo.data.gouv.fr/data/france.json',
    'https://openmaptiles.github.io/fonts/a.pbf',
    'data:image/png;base64,AAAA',
    'blob:https://pdf.cartobio.invalid/1234'
  ])('laisse passer %s', async (url) => {
    const request = await intercept(url)
    expect(request.continue).toHaveBeenCalled()
    expect(request.abort).not.toHaveBeenCalled()
  })

  test.each([
    'http://openmaptiles.geo.data.gouv.fr/data/france.json',
    'https://evil.example.com/',
    'https://openmaptiles.github.io.evil.example.com/',
    'file:///etc/passwd',
    'http://169.254.169.254/latest/meta-data/',
    'https://pdf.cartobio.invalid/autre.html'
  ])('bloque %s', async (url) => {
    const request = await intercept(url)
    expect(request.abort).toHaveBeenCalled()
    expect(request.continue).not.toHaveBeenCalled()
    expect(request.respond).not.toHaveBeenCalled()
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

    vi.spyOn(fs, 'readFile').mockImplementation(((_: unknown, __: unknown, cb: (error: null, data: string) => void) => {
      cb(null, JSON.stringify({ version: 8, sources: {}, layers: [] }))
    }) as unknown as typeof fs.readFile)
  })

  afterEach(() => {
    vi.mocked(fs.readFile).mockRestore()
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
      'Délai dépassé lors du chargement de la page avec le style Page style'
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
    expect(result).toEqual({ error: 'Délai dépassé (5000 ms)' })
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
  let firstPage: Record<string, Mock>
  let secondPage: Record<string, Mock>

  beforeEach(() => {
    vi.mocked(fs.unlinkSync).mockClear()
    firstPage = { getSize: vi.fn(() => ({ width: 100 })), drawText: vi.fn() }
    secondPage = { getSize: vi.fn(() => ({ width: 100 })), drawText: vi.fn() }

    mockLoadedPdf = {
      getPageIndices: vi.fn(() => [0])
    }

    mockMergedPdf = {
      addPage: vi.fn(),
      copyPages: vi.fn().mockResolvedValueOnce([firstPage]).mockResolvedValueOnce([secondPage])
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
    expect(mockMergedPdf.addPage!.mock.calls).toEqual([[firstPage], [secondPage]])
    expect(firstPage.drawText).not.toHaveBeenCalled()
    expect(secondPage.drawText!.mock.calls).toEqual([
      ['2', { x: 62, y: 20, size: 9 }],
      ['TestName', { x: 38, y: 20, size: 9 }]
    ])
    expect(fs.unlinkSync).toHaveBeenCalledWith('doc1.pdf')
    expect(fs.unlinkSync).toHaveBeenCalledWith('doc2.pdf')
    expect(result).toBe(mockMergedPdf)
  })

  it('conserve les fichiers sources si la suppression n’est pas demandée', async () => {
    await mergeAndAddFooter(['doc1.pdf', 'doc2.pdf'], 'TestName', false)

    expect(fs.unlinkSync).not.toHaveBeenCalled()
  })
})

describe('getAllParcelles', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('retourne les parcelles du repository sans les transformer', async () => {
    const parcelles = [buildPdfParcelle({ id: 'p1' })]
    vi.mocked(findPdfParcelles).mockResolvedValueOnce(parcelles)

    expect(await getAllParcelles('some-record-id')).toBe(parcelles)
    expect(findPdfParcelles).toHaveBeenCalledWith('some-record-id', false)
  })

  it('transmet le filtre PAC', async () => {
    vi.mocked(findPdfParcelles).mockResolvedValueOnce([])

    await getAllParcelles('some-record-id', true)

    expect(findPdfParcelles).toHaveBeenCalledWith('some-record-id', true)
  })

  it("propage l'erreur de la base", async () => {
    vi.mocked(findPdfParcelles).mockRejectedValueOnce(new Error('DB down'))

    await expect(getAllParcelles('fail-id')).rejects.toThrow('DB down')
  })
})
