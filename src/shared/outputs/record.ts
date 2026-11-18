import { normalizeParcelle } from './features.js'
import { EtatProduction } from '@agencebio/cartobio-types'
import type { NormalizedRecord, NormalizedRecordSummary } from '@agencebio/cartobio-types'
import type { DBOperatorRecordWithParcelles, RecordSummaryRow } from '../parcellaires/parcellaires.types.js'

/**
 * Normalize a record
 */
export function normalizeRecord(record: DBOperatorRecordWithParcelles): NormalizedRecord {
  const features = (record?.parcelles ?? []).map(normalizeParcelle)

  return {
    ...record,
    metadata: record?.metadata ?? {},
    parcelles: { type: 'FeatureCollection', features }
  }
}

export function normalizeRecordSummary(record: RecordSummaryRow): NormalizedRecordSummary {
  return {
    ...record
  }
}

export function normalizeEtatProduction(
  etat: string,
  options: { strict: boolean } = { strict: false }
): EtatProduction | string {
  if (Object.hasOwn(EtatProduction, etat)) {
    return EtatProduction[etat as keyof typeof EtatProduction]
  }

  if (options.strict) {
    throw new Error(`EtatProduction invalide: ${etat}`)
  }

  return etat
}

export function redactAuditNotes(record: NormalizedRecord): NormalizedRecord {
  record.audit_notes = null
  record.audit_demandes = null
  record.parcelles = {
    ...record.parcelles,
    features: record.parcelles.features.map((feature) => {
      feature.properties.auditeur_notes = null
      feature.properties.annotations = []
      return feature
    })
  }
  return record
}
