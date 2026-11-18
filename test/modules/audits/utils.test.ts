import { CertificationState } from '@agencebio/cartobio-types'
import type { FeatureInput } from '@agencebio/cartobio-types'
import {
  assertConversionNiveau,
  assertUnmodified,
  unmodifiedSinceCondition
} from '../../../src/modules/audits/audits.utils.js'

const feature = (properties: Record<string, unknown> | null): FeatureInput =>
  ({ type: 'Feature', geometry: null, properties }) as unknown as FeatureInput

const invalidRequest = expect.objectContaining({
  statusCode: 400,
  message: 'Le niveau de conversion est obligatoire.'
}) as Error

describe('assertConversionNiveau', () => {
  test.each([null, undefined, '', CertificationState.OPERATOR_DRAFT])(
    "n'exige rien pour un parcellaire à l'état %s",
    (state) => {
      expect(() => assertConversionNiveau(state, [feature({})], true)).not.toThrow()
    }
  )

  describe('à la création', () => {
    test.each([
      ['absent', {}],
      ['vide', { conversion_niveau: '' }],
      ['null', { conversion_niveau: null }],
      ['sans propriétés', null]
    ])('refuse un niveau de conversion %s', (_, properties) => {
      expect(() =>
        assertConversionNiveau(
          CertificationState.AUDITED,
          [feature({ conversion_niveau: 'AB' }), feature(properties)],
          true
        )
      ).toThrow(invalidRequest)
    })

    test('accepte quand toutes les parcelles ont un niveau de conversion', () => {
      expect(() =>
        assertConversionNiveau(
          CertificationState.AUDITED,
          [feature({ conversion_niveau: 'AB' }), feature({ conversion_niveau: 'C1' })],
          true
        )
      ).not.toThrow()
    })
  })

  describe('à la modification', () => {
    test.each([
      ['vide', { conversion_niveau: '' }],
      ['null', { conversion_niveau: null }]
    ])('refuse de passer le niveau de conversion à %s', (_, properties) => {
      expect(() => assertConversionNiveau(CertificationState.CERTIFIED, [feature(properties)], false)).toThrow(
        invalidRequest
      )
    })

    test('accepte une modification qui ne touche pas au niveau de conversion', () => {
      expect(() =>
        assertConversionNiveau(CertificationState.CERTIFIED, [feature({ name: 'Parcelle' }), feature(null)], false)
      ).not.toThrow()
    })
  })
})

describe('assertUnmodified', () => {
  test("lève une erreur 412 quand aucune ligne n'a été mise à jour", () => {
    expect(() => assertUnmodified([])).toThrow(
      expect.objectContaining({ statusCode: 412, code: 'PRECONDITION_FAILED' }) as Error
    )
  })

  test('accepte quand au moins une ligne a été mise à jour', () => {
    expect(() => assertUnmodified([{ recordId: '1' }])).not.toThrow()
  })
})

describe('unmodifiedSinceCondition', () => {
  test.each([undefined, '', 'pas une date'])("ne filtre pas avec l'en-tête %s", (header) => {
    expect(unmodifiedSinceCondition(header)).toBeUndefined()
  })
})
