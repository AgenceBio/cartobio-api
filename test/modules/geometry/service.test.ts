import * as repository from '../../../src/modules/geometry/geometry.repository.js'
import { calculateParcelBorder, verifyGeometry } from '../../../src/modules/geometry/geometry.service.js'

vi.mock('../../../src/modules/geometry/geometry.repository.js')

const mockedRepo = vi.mocked(repository)
const geometry = { type: 'Polygon', coordinates: [] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('verifyGeometry', () => {
  test('valide une géométrie sans conflit', async () => {
    mockedRepo.findGeometryConflicts.mockResolvedValue([{ id: 'a', status: 'ok' }])

    expect(await verifyGeometry(geometry, 'record', 'p1')).toEqual({ valid: true })
    expect(mockedRepo.findGeometryConflicts).toHaveBeenCalledWith(geometry, 'record', 'p1')
    expect(mockedRepo.findGeometryCorrections).not.toHaveBeenCalled()
  })

  test('refuse sans correction une géométrie incluse dans une autre', async () => {
    mockedRepo.findGeometryConflicts.mockResolvedValue([
      { id: 'a', status: 'overlap' },
      { id: 'b', status: 'inclusion' }
    ])

    expect(await verifyGeometry(geometry, 'record')).toEqual({ valid: false })
    expect(mockedRepo.findGeometryCorrections).not.toHaveBeenCalled()
  })

  test('propose des corrections pour les seules parcelles chevauchées', async () => {
    const corrections = [
      { id: 'a', new_minus_intersection: null, existing_minus_intersection: null, intersection: null }
    ]
    mockedRepo.findGeometryConflicts.mockResolvedValue([
      { id: 'a', status: 'overlap' },
      { id: 'b', status: 'ok' },
      { id: 'c', status: 'overlap' }
    ])
    mockedRepo.findGeometryCorrections.mockResolvedValue(corrections)

    expect(await verifyGeometry(geometry, 'record')).toEqual({ valid: false, corrections })
    expect(mockedRepo.findGeometryCorrections).toHaveBeenCalledWith(geometry, 'record', ['a', 'c'])
  })
})

describe('calculateParcelBorder', () => {
  test('calcule la bordure complète sans points', async () => {
    await calculateParcelBorder(geometry, 5, true, false)

    expect(mockedRepo.findParcelBorder).toHaveBeenCalledWith(geometry, 5)
    expect(mockedRepo.findParcelBorderBetweenPoints).not.toHaveBeenCalled()
  })

  test('calcule la bordure entre deux points', async () => {
    await calculateParcelBorder(geometry, 5, false, true, [0, 0], [1, 1])

    expect(mockedRepo.findParcelBorderBetweenPoints).toHaveBeenCalledWith(geometry, 5, [0, 0], [1, 1], true)
  })

  test.each([
    [undefined, [1, 1]],
    [[0, 0], undefined]
  ])('exige les deux points pour une bordure partielle', async (start, end) => {
    await expect(calculateParcelBorder(geometry, 5, false, false, start, end)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Les deux points sont requis'
    })
  })
})
