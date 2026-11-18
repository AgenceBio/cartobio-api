import type { Polygon } from 'geojson'
import type { DBOperatorRecord } from '@agencebio/cartobio-types'

export type GeometryFixAnalysis = {
  already_valid: boolean
  is_polygon: boolean
  diff_ha: number
  diff_pct: number
  geometry: Polygon
}

export type RecordSummaryRow = Omit<DBOperatorRecord, 'parcelles'> & { surface: number; parcelles: number }
