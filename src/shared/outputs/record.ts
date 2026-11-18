import { normalizeParcelle } from './features.js'
import { EtatProduction } from '@agencebio/cartobio-types'
import type { NormalizedRecord, NormalizedRecordSummary } from '@agencebio/cartobio-types'
import type { DBOperatorRecordWithParcelles, RecordSummaryRow } from '../parcellaires/parcellaires.types.js'

/**
 * Normalize a record
 */
function normalizeRecord(record: DBOperatorRecordWithParcelles): NormalizedRecord {
  const features = (record?.parcelles ?? []).map(normalizeParcelle)

  return {
    ...record,
    metadata: record?.metadata ?? {},
    parcelles: { type: 'FeatureCollection', features }
  }
}

function normalizeRecordSummary(record: RecordSummaryRow): NormalizedRecordSummary {
  return {
    ...record
  }
}

function normalizeEtatProduction(
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

export { normalizeRecord, normalizeRecordSummary, normalizeEtatProduction }
