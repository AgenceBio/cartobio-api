import type { Polygon } from 'geojson'
import { compareParcellaires, feature, label } from '../../../src/modules/geometry/geometry.utils.js'

const dates = (auditDate: string | null, anneeReferenceControle: number, createdAt = '2024-01-01') => ({
  auditDate,
  anneeReferenceControle,
  createdAt: new Date(createdAt)
})

describe('compareParcellaires', () => {
  test("compare les dates d'audit quand les deux en ont une", () => {
    expect(compareParcellaires(dates('2024-03-01', 2025), dates('2024-06-01', 2023))).toBe('r1_old_r2_new')
    expect(compareParcellaires(dates('2024-06-01', 2023), dates('2024-03-01', 2025))).toBe('r2_old_r1_new')
  })

  test("se rabat sur l'année d'audit ou l'année de référence", () => {
    expect(compareParcellaires(dates('2023-12-01', 2025), dates(null, 2024))).toBe('r1_old_r2_new')
    expect(compareParcellaires(dates(null, 2025), dates('2024-12-01', 2020))).toBe('r2_old_r1_new')
    expect(compareParcellaires(dates(null, 2023), dates(null, 2024))).toBe('r1_old_r2_new')
  })

  test('départage par date de création', () => {
    expect(compareParcellaires(dates(null, 2024, '2024-02-01'), dates(null, 2024, '2024-01-01'))).toBe('r2_old_r1_new')
    expect(compareParcellaires(dates('2024-01-01', 0, '2024-01-01'), dates('2024-01-01', 0, '2024-02-01'))).toBe(
      'r1_old_r2_new'
    )
  })
})

describe('label', () => {
  test('nomme une parcelle PAC par son îlot et sa parcelle', () => {
    expect(label({ numeroIlotPac: 3, numeroParcellesPac: 2, name: 'Champ' })).toBe('Ilot 3 Parcelle 2')
    expect(label({ numeroIlotPac: 3, numeroParcellesPac: null, name: null })).toBe('Ilot 3 Parcelle ?')
  })

  test('utilise le nom, sinon un libellé générique', () => {
    expect(label({ numeroIlotPac: null, numeroParcellesPac: 2, name: 'Champ' })).toBe('Champ')
    expect(label({ numeroIlotPac: null, numeroParcellesPac: null, name: null })).toBe('Parcelle')
  })
})

describe('feature', () => {
  test('construit une Feature GeoJSON', () => {
    const geometry: Polygon = { type: 'Polygon', coordinates: [] }
    expect(feature(geometry, { id: 1 })).toEqual({
      type: 'Feature',
      properties: { id: 1 },
      geometry
    })
    expect(feature(null, {})).toEqual({ type: 'Feature', properties: {}, geometry: null })
  })
})
