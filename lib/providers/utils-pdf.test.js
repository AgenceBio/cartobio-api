const { getOptimalZoom, getAllParcelles, calculateGlobalBoundingBox, formatDate, launchStyleTab, drawParcelleHighlightOnMap, drawAllParcellesOnMap, mergeAndAddFooter } = require('./utils-pdf.js')
const fs = require('fs')
const path = require('path')
const pdflib = require('pdf-lib')
const pool = require('../db.js')

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
      { minx: 1, miny: 2, maxx: 5, maxy: 6 },
      { minx: 2, miny: 1, maxx: 6, maxy: 7 }
    ]
    const bbox = calculateGlobalBoundingBox(parcelles)
    expect(bbox).toEqual({
      minx: 1, miny: 1, maxx: 6, maxy: 7, centerx: 3.5, centery: 4, width: 5, height: 6
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
  let pageMock
  let browserMock

  beforeEach(() => {
    pageMock = {
      goto: jest.fn().mockResolvedValue(),
      evaluate: jest.fn().mockResolvedValue(),
      close: jest.fn()
    }

    browserMock = {
      newPage: jest.fn().mockResolvedValue(pageMock)
    }

    path.resolve = jest.fn().mockImplementation((...args) => args.join('/'))
    jest.spyOn(fs, 'readFile').mockImplementation((_, __, cb) => {
      cb(null, JSON.stringify({ version: 8, sources: {}, layers: [] }))
    })
  })

  it('devrait charger la page avec le style', async () => {
    const page = await launchStyleTab(browserMock)
    expect(browserMock.newPage).toHaveBeenCalled()
    expect(pageMock.goto).toHaveBeenCalled()
    expect(pageMock.evaluate).toHaveBeenCalled()
    expect(page).toBe(pageMock)
  })

  it('devrait gérer une erreur lors du chargement', async () => {
    pageMock.goto.mockRejectedValue(new Error('Page style'))

    await expect(launchStyleTab(browserMock)).rejects.toThrow('Timeout lors du chargement de la page avec le style Page style')
    expect(pageMock.close).toHaveBeenCalled()
  })
})

describe('drawAllParcellesOnMap', () => {
  let pageMock

  beforeEach(() => {
    pageMock = {
      setViewport: jest.fn().mockResolvedValue(),
      waitForSelector: jest.fn().mockResolvedValue(),
      waitForFunction: jest.fn().mockResolvedValue(),
      evaluate: jest.fn().mockResolvedValue(null),
      screenshot: jest.fn().mockResolvedValue('fake-base64-image')
    }
  })

  const parcelles = [
    {
      id: '123',
      geojson: JSON.stringify({
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
      })
    }
  ]

  const options = {
    width: 800,
    height: 600,
    center: [2, 48],
    zoom: 13,
    timeout: 5000
  }

  it('devrait retourner un buffer base64 si tout se passe bien', async () => {
    const result = await drawAllParcellesOnMap(pageMock, parcelles, options)

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
    pageMock.evaluate.mockResolvedValue('Erreur JS dans le navigateur')

    const result = await drawAllParcellesOnMap(pageMock, parcelles, options)
    expect(result).toEqual({ error: 'Erreur JS dans le navigateur' })
  })

  it('devrait retourner une erreur de timeout', async () => {
    pageMock.waitForFunction.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Timeout'))

    const result = await drawAllParcellesOnMap(pageMock, parcelles, options)
    expect(result).toEqual({ error: 'Timeout exceeded (5000ms)' })
  })
})

describe('drawParcelleHighlightOnMap', () => {
  let pageMock

  beforeEach(() => {
    pageMock = {
      setViewport: jest.fn().mockResolvedValue(),
      waitForSelector: jest.fn().mockResolvedValue(),
      waitForFunction: jest.fn().mockResolvedValue(),
      evaluate: jest.fn().mockResolvedValue(null),
      screenshot: jest.fn().mockResolvedValue('highlighted-img')
    }
  })

  const parcelles = [
    { id: '1', geojson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }) },
    { id: '2', geojson: JSON.stringify({ type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] }) }
  ]

  const highlight = { ...parcelles[0], name: 'Test', nbilot: '12', nbp: '34' }

  const options = {
    width: 800,
    height: 600,
    center: [2, 48],
    zoom: 13,
    timeout: 5000
  }

  it('retourne une image avec la parcelle en surbrillance', async () => {
    const result = await drawParcelleHighlightOnMap(pageMock, parcelles, highlight, options)
    expect(result).toEqual({ buffer: 'highlighted-img' })
    expect(pageMock.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      parcelles,
      parcelleHighlight: highlight,
      center: options.center,
      zoom: options.zoom
    })
  })

  it('retourne une erreur si evaluate échoue', async () => {
    pageMock.evaluate.mockResolvedValue("Erreur dans l'éval")
    const result = await drawParcelleHighlightOnMap(pageMock, parcelles, highlight, options)
    expect(result).toEqual({ error: "Erreur dans l'éval" })
  })
})

jest.mock('pdf-lib')

jest.spyOn(fs, 'readFileSync').mockImplementation((path) => {
  return Buffer.from(`PDF data for ${path}`)
})
jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {})

describe('mergeAndAddFooter', () => {
  let mockMergedPdf
  let mockLoadedPdf
  let mockPage

  beforeEach(() => {
    mockPage = {
      getSize: jest.fn(() => ({ width: 100 })),
      drawText: jest.fn()
    }

    mockLoadedPdf = {
      getPageIndices: jest.fn(() => [0])
    }

    mockMergedPdf = {
      addPage: jest.fn(),
      copyPages: jest.fn().mockResolvedValue([mockPage]),
      saveAsBase64: jest.fn().mockResolvedValue('mocked-pdf-base64')
    }
    pdflib.PDFDocument.create.mockResolvedValue(mockMergedPdf)
    pdflib.PDFDocument.load.mockResolvedValue(mockLoadedPdf)
  })

  it('devrait fusionner les PDFs et ajouter un pied de page', async () => {
    const pdfPaths = ['doc1.pdf', 'doc2.pdf']
    const name = 'TestName'

    const result = await mergeAndAddFooter(pdfPaths, name)

    expect(pdflib.PDFDocument.load).toHaveBeenCalledTimes(2)
    expect(mockMergedPdf.copyPages).toHaveBeenCalledTimes(2)
    expect(mockMergedPdf.addPage).toHaveBeenCalledTimes(2)
    expect(mockPage.drawText).toHaveBeenCalledWith('2', expect.objectContaining({ x: expect.any(Number), y: 20 }))
    expect(mockPage.drawText).toHaveBeenCalledWith('TestName', expect.objectContaining({ x: 38, y: 20 }))
    expect(fs.unlinkSync).toHaveBeenCalledWith('doc1.pdf')
    expect(fs.unlinkSync).toHaveBeenCalledWith('doc2.pdf')
    expect(result).toBe('mocked-pdf-base64')
  })
})

describe('getAllParcelles', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('retourne les parcelles avec le geojson parsé', async () => {
    const mockRow = {
      id: 'p1',
      name: 'Parcelle 1',
      geojson: '{"type":"Polygon","coordinates":[[[4.979616538,47.353725228],[4.974457803,47.347718045],[4.979777749,47.346188835],[4.985742536,47.350994775],[4.979616538,47.353725228]]]}',
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
    pool.query.mockResolvedValueOnce({
      rows: [mockRow]
    })
    const result = await getAllParcelles('some-record-id')
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT'), ['some-record-id'])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'p1',
      geojson: '{"type":"Polygon","coordinates":[[[4.979616538,47.353725228],[4.974457803,47.347718045],[4.979777749,47.346188835],[4.985742536,47.350994775],[4.979616538,47.353725228]]]}',
      name: 'Parcelle 1',
      superficie_totale_ha: 1.23
    })
  })

  it('retourne [] et loggue en cas d\'erreur', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    pool.query.mockRejectedValueOnce(new Error('DB down'))

    const result = await getAllParcelles('fail-id')

    expect(pool.query).toHaveBeenCalled()
    expect(result).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Erreur lors de la récupération des parcelles:',
      expect.any(Error)
    )

    consoleErrorSpy.mockRestore()
  })
})
