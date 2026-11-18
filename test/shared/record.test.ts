import { normalizeEtatProduction, normalizeRecord, redactAuditNotes } from '../../src/shared/outputs/record.js'
import { asDBRecordWithParcelles, buildFeature, buildNormalizedRecord } from '../factories.js'

describe('normalizeEtatProduction', () => {
  test.each([
    ['C0', 'CONV'],
    ['NB', 'CONV'],
    ['BIO', 'AB?'],
    ['C2', 'C2'],
    ['AB', 'AB']
  ])('convertit %s en %s', (etat, expected) => {
    expect(normalizeEtatProduction(etat)).toBe(expected)
  })

  test('laisse passer une valeur inconnue en mode souple', () => {
    expect(normalizeEtatProduction('XX')).toBe('XX')
  })

  test('rejette une valeur inconnue en mode strict', () => {
    expect(() => normalizeEtatProduction('XX', { strict: true })).toThrow('EtatProduction invalide: XX')
  })

  test('ne se laisse pas tromper par les propriétés héritées', () => {
    expect(() => normalizeEtatProduction('toString', { strict: true })).toThrow()
  })
})

describe('normalizeRecord', () => {
  test('remplit metadata et parcelles absentes', () => {
    expect(normalizeRecord(asDBRecordWithParcelles({ record_id: 'r', metadata: null, parcelles: null }))).toEqual({
      record_id: 'r',
      metadata: {},
      parcelles: { type: 'FeatureCollection', features: [] }
    })
  })
})

describe('redactAuditNotes', () => {
  test("efface les notes et annotations d'audit", () => {
    const record = buildNormalizedRecord({
      audit_notes: 'notes',
      audit_demandes: 'demandes',
      parcelles: {
        type: 'FeatureCollection',
        features: [buildFeature({ properties: { auditeur_notes: 'note', annotations: [{ code: 'x' }] as never } })]
      }
    })

    const redacted = redactAuditNotes(record)

    expect(redacted).toMatchObject({ audit_notes: null, audit_demandes: null })
    expect(redacted.parcelles.features[0]!.properties).toMatchObject({ auditeur_notes: null, annotations: [] })
  })
})
