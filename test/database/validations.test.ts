import {
  createCommuneSchema,
  createDepartementSchema,
  createRegionSchema,
  createTerritoireSchema,
  updateCommuneSchema
} from '../../src/database/validations/geographie.js'

describe('validations géographiques', () => {
  test('nettoie les codes et noms', () => {
    expect(createRegionSchema.parse({ code: ' 84 ', nom: ' Auvergne-Rhône-Alpes ' })).toEqual({
      code: '84',
      nom: 'Auvergne-Rhône-Alpes'
    })
    expect(createDepartementSchema.parse({ fid: '26', nom: 'Drôme', codeRegion: '84' })).toMatchObject({ fid: '26' })
    expect(createCommuneSchema.parse({ fid: '26362', nom: 'Valence', active: true })).toMatchObject({ fid: '26362' })
    expect(createTerritoireSchema.parse({ fid: 'region-84' })).toMatchObject({ fid: 'region-84' })
  })

  test.each([
    ['une région sans nom', () => createRegionSchema.parse({ code: '84', nom: '   ' })],
    ['un département sans région', () => createDepartementSchema.parse({ fid: '26', nom: 'Drôme', codeRegion: '' })],
    ['une commune sans code', () => createCommuneSchema.parse({ fid: '', nom: 'Valence' })],
    ['une géométrie', () => createCommuneSchema.parse({ fid: '1', nom: 'X', geometry: {} })],
    ['une mise à jour hors activation', () => updateCommuneSchema.parse({ nom: 'X' })]
  ])('refuse %s', (_, parse) => {
    expect(parse).toThrow()
  })
})
