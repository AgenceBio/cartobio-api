import * as generatePdf from '../../../src/modules/exports/pdf-content.js'
import * as utils from '../../../src/modules/exports/pdf-utils.js'
import type { Page } from 'puppeteer'
import { buildPdfParcelle } from '../../factories.js'

vi.mock('../../../src/modules/exports/pdf-utils.js', () => ({
  calculateGlobalBoundingBox: vi.fn(),
  getOptimalZoom: vi.fn(),
  drawAllParcellesOnMap: vi.fn(),
  drawParcelleHighlightOnMap: vi.fn(),
  getAllParcelles: vi.fn(),
  launchStyleTab: vi.fn().mockImplementation(() => { throw new Error('Test') })
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
    expect(result.parcelles[0].id).toBe('parcelle-1')
    expect(result.parcelles[0].buffer).toBe('parcelle-image')
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
    expect(result.parcelles[0].id).toBe('parcelle-1')
  })
})
