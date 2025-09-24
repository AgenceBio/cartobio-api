const generatePdf = require('./generate-pdf-content')
const utils = require('./utils-pdf')

jest.mock('./utils-pdf', () => ({
  calculateGlobalBoundingBox: jest.fn(),
  getOptimalZoom: jest.fn(),
  drawAllParcellesOnMap: jest.fn(),
  drawParcelleHighlightOnMap: jest.fn(),
  getAllParcelles: jest.fn(),
  launchStyleTab: jest.fn().mockImplementation(() => { throw new Error('Test') })
}))

describe('generateOperatorMapImages', () => {
  const mockPage = {}
  const sampleParcelles = [
    {
      id: 'parcelle-1',
      minx: 1,
      miny: 1,
      maxx: 3,
      maxy: 3,
      centerx: 2,
      centery: 2
    },
    {
      id: 'parcelle-2',
      minx: 2,
      miny: 2,
      maxx: 4,
      maxy: 4,
      centerx: 3,
      centery: 3
    }
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('génère les images correctement pour les parcelles', async () => {
    utils.calculateGlobalBoundingBox.mockReturnValue({
      width: 10,
      height: 10,
      centerx: 5,
      centery: 5
    })

    utils.getOptimalZoom.mockReturnValue(12)

    utils.drawAllParcellesOnMap.mockResolvedValue({
      buffer: Buffer.from('global-image'),
      error: null
    })

    utils.drawParcelleHighlightOnMap.mockResolvedValue({
      buffer: Buffer.from('parcelle-image'),
      error: null
    })

    const result = await generatePdf.generateOperatorMapImages(sampleParcelles, mockPage)

    expect(utils.calculateGlobalBoundingBox).toHaveBeenCalledWith(sampleParcelles)
    expect(utils.drawAllParcellesOnMap).toHaveBeenCalled()
    expect(utils.drawParcelleHighlightOnMap).toHaveBeenCalledTimes(2)

    expect(result.global.buffer.toString()).toBe('global-image')
    expect(result.parcelles).toHaveLength(2)
    expect(result.parcelles[0].id).toBe('parcelle-1')
    expect(result.parcelles[0].buffer.toString()).toBe('parcelle-image')
  })

  it('gère une erreur dans drawAllParcellesOnMap', async () => {
    utils.calculateGlobalBoundingBox.mockReturnValue({
      width: 10,
      height: 10,
      centerx: 5,
      centery: 5
    })

    utils.getOptimalZoom.mockReturnValue(12)

    utils.drawAllParcellesOnMap.mockResolvedValue({
      buffer: null,
      error: 'some error'
    })

    const result = await generatePdf.generateOperatorMapImages(sampleParcelles, mockPage)

    expect(result.global).toBeNull()
    expect(result.parcelles).toEqual([])
  })

  it('ignore les parcelles avec erreur individuelle', async () => {
    utils.calculateGlobalBoundingBox.mockReturnValue({
      width: 10,
      height: 10,
      centerx: 5,
      centery: 5
    })

    utils.getOptimalZoom.mockReturnValue(12)

    utils.drawAllParcellesOnMap.mockResolvedValue({
      buffer: Buffer.from('global-image'),
      error: null
    })

    utils.drawParcelleHighlightOnMap
      .mockResolvedValueOnce({ buffer: Buffer.from('parcelle-image-1'), error: null })
      .mockResolvedValueOnce({ buffer: null, error: 'error' })

    const result = await generatePdf.generateOperatorMapImages(sampleParcelles, mockPage)

    expect(result.parcelles).toHaveLength(1)
    expect(result.parcelles[0].id).toBe('parcelle-1')
  })
})
