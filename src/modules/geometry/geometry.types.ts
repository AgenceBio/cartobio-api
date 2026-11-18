import type { GeometryEqualsResponse } from '@agencebio/cartobio-types'
import type { Geometry } from 'geojson'
import type { parcellaires, parcelles } from '../../database/schema/index.js'

export type ComparisonResult = GeometryEqualsResponse[number]['comparison_result']

export type GeometryConflictStatus = 'inclusion' | 'overlap' | 'ok'

export type ParcellaireDates = Pick<
  typeof parcellaires.$inferSelect,
  'auditDate' | 'anneeReferenceControle' | 'createdAt'
>

export type ParcelleLabel = Pick<typeof parcelles.$inferSelect, 'numeroIlotPac' | 'numeroParcellesPac' | 'name'>

export type ParcelleColumnKey = 'id' | 'numeroIlotPac' | 'numeroParcellesPac' | 'name'

export type ParcellaireComparable = ParcellaireDates & Pick<typeof parcellaires.$inferSelect, 'recordId' | 'numeroBio'>

type ParcelleComparee = Pick<typeof parcelles.$inferSelect, ParcelleColumnKey>

export type ParcellesComparees = {
  modified: Array<{
    geometry: Geometry | null
    ancienne: ParcelleComparee
    nouvelle: ParcelleComparee
  }>
  deleted: Array<ParcelleComparee & { geometry: Geometry | null }>
  added: Array<ParcelleComparee & { geometry: Geometry | null }>
}

export type GeometryConflict = {
  id: string
  status: GeometryConflictStatus
}

export type GeometryCorrection = {
  id: string
  new_minus_intersection: Geometry | null
  existing_minus_intersection: Geometry | null
  intersection: Geometry | null
}

export type ParcelBorder = {
  parcelleSansBordure: Geometry | null
  bordure: Geometry | null
}
