import { featureCollection } from '@turf/helpers'
import { normalizeParcelle } from './features.js'
import { EtatProduction } from '@agencebio/cartobio-types'
import type { DBOperatorRecord, DBOperatorRecordWithParcelles, NormalizedRecord, NormalizedRecordSummary } from '@agencebio/cartobio-types'


/**
 * Normalize a record
 */
function normalizeRecord (record: DBOperatorRecordWithParcelles): NormalizedRecord {
  const features = (record?.parcelles ?? [])
    .map(normalizeParcelle)

  return {
    ...record,
    metadata: record?.metadata ?? {},
    parcelles: featureCollection(features)
  }
}

function normalizeRecordSummary (record: Omit<DBOperatorRecord, 'parcelles'> & { surface: number; parcelles: number }): NormalizedRecordSummary {
  return {
    ...record
  }
}

function normalizeEtatProduction (etat: string, options: { strict: boolean } = { strict: false }): EtatProduction | string {
  if (Object.hasOwn(EtatProduction, etat)) {
    return EtatProduction[etat as keyof typeof EtatProduction]
  }

  if (options.strict) {
    throw new Error(`EtatProduction invalide: ${etat}`)
  }

  return etat
}

export { normalizeRecord, normalizeRecordSummary, normalizeEtatProduction }
