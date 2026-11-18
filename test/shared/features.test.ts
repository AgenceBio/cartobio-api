import { getRandomFeatureId, populateWithMultipleCultures } from '../../src/shared/outputs/features.js'
import { normalizeParcelle } from '../../src/shared/outputs/features.js'
import type { CartoBioFeatureInput } from '@agencebio/cartobio-types'
import { buildCulture, buildDBParcelle } from '../factories.js'

describe('getRandomFeatureId', () => {
  test('returns a GeoJSON compatible feature id', () => {
    // 281474976710656 === Math.pow(2, 48)
    expect(getRandomFeatureId()).toBeLessThan(281474976710656)
  })

  test('returns two different id when called sequentially', () => {
    expect(getRandomFeatureId()).not.toBe(getRandomFeatureId())
  })
})

describe('normalizeFeature', () => {
  test('adds COMMUNE_LABEL if the feature contains a commune code', () => {
    const culture = buildCulture({ CPF: '01.19.10.8' })
    const parcelle = buildDBParcelle({
      id: '1234',
      commune: '26108',
      commune_label: 'Crest',
      cultures: [culture]
    })

    const expectation = {
      type: 'Feature',
      id: '1234',
      properties: {
        id: '1234',
        COMMUNE: '26108',
        COMMUNE_LABEL: 'Crest',
        cultures: [culture]
      }
    }

    expect(normalizeParcelle(parcelle)).toMatchObject(expectation)
  })

  test('does not add COMMUNE_LABEL if the feature does not contain a commune code', () => {
    const feature = buildDBParcelle({ id: 'aaaa' })
    const featureWithEmptyCommune = buildDBParcelle({ id: 'aaaa', commune: '' })
    const featureWithNullCommune = buildDBParcelle({ id: 'aaaa', commune: null })

    expect(normalizeParcelle(feature).properties.COMMUNE_LABEL).toBeUndefined()
    expect(normalizeParcelle(featureWithEmptyCommune).properties.COMMUNE_LABEL).toBeUndefined()
    expect(normalizeParcelle(featureWithNullCommune).properties.COMMUNE_LABEL).toBeUndefined()
  })
})

describe('populateWithMultipleCultures', () => {
  // @see https://fr.wikipedia.org/wiki/Universally_unique_identifier
  const UUID_RE = /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/

  test('converts into a new structure if `cultures` is not an array', () => {
    const feature: CartoBioFeatureInput = {
      type: 'Feature',
      geometry: null,
      properties: {
        TYPE: 'PCL',
        variete: 'abc',
        SURF: 1.2
      }
    }
    const expectation = {
      type: 'Feature',
      properties: {
        cultures: [
          { TYPE: 'PCL', CPF: '01.19.10.11', variete: 'abc', surface: 1.2 }
        ]
      }
    }

    expect(populateWithMultipleCultures(feature)).toMatchObject(expectation)
    expect(populateWithMultipleCultures(feature)).toHaveProperty('properties.cultures[0].id', expect.stringMatching(UUID_RE))
  })

  test('adds CPF codes whenever they are missing', () => {
    const featureWithKnownCPF: CartoBioFeatureInput = {
      type: 'Feature',
      geometry: null,
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'PCL', variete: 'abc' },
          { id: 'bbbb', TYPE: 'AGR' } /* is_selectable === true ?? */
        ]
      }
    }

    const expectationWithKnownCPF = {
      type: 'Feature',
      geometry: null,
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'PCL', CPF: '01.19.10.11', variete: 'abc' },
          { id: 'bbbb', TYPE: 'AGR' }
        ]
      }
    }

    const featureWithUnknownCPF: CartoBioFeatureInput = {
      type: 'Feature',
      geometry: null,
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'ZZZ', variete: 'abc' },
          { id: 'bbbb', TYPE: '@@@' }
        ]
      }
    }

    const expectationWithUnknownCPF = {
      type: 'Feature',
      geometry: null,
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'ZZZ', variete: 'abc' },
          { id: 'bbbb', TYPE: '@@@', CPF: undefined }
        ]
      }
    }

    expect(populateWithMultipleCultures(featureWithKnownCPF)).toEqual(expectationWithKnownCPF)
    expect(populateWithMultipleCultures(featureWithUnknownCPF)).toEqual(expectationWithUnknownCPF)
  })

  test('keeps properties untouched if a feature has multiple cultures structure', () => {
    const featureWithPAC: CartoBioFeatureInput = {
      type: 'Feature',
      geometry: null,
      properties: {
        TYPE: 'PCL',
        cultures: [
          { id: 'aaaa', CPF: '01.19.10.11', TYPE: 'PCL' }
        ]
      }
    }

    const featureWithCPF: CartoBioFeatureInput = {
      type: 'Feature',
      geometry: null,
      properties: {
        CPF: '01.19.10.12',
        cultures: [
          { id: 'aaaa', CPF: '01.19.10.12' },
          { id: 'aaaa', CPF: '01.11.2' }
        ]
      }
    }

    expect(populateWithMultipleCultures(featureWithPAC)).toEqual(featureWithPAC)
    expect(populateWithMultipleCultures(featureWithCPF)).toEqual(featureWithCPF)
  })
})
