import type { Polygon } from 'geojson'
import type { SelectResultFields } from 'drizzle-orm/query-builders/select.types'
import type { CartoBioFeatureCollectionInput, CartoBioHistoriqueCulture, RecordInfos } from '@agencebio/cartobio-types'
import type { parcelleColumns, recordColumns } from './parcellaires.utils.js'

export type GeometryAnalysis = {
  statut: 'ACCEPTE' | 'UNCORRECTABLE' | 'ACCEPTENONCORRIGE' | 'CORRIGE'
  etranger: boolean | null
  geometry: Polygon | null
  commune: string | null
}

type DBRecord = SelectResultFields<typeof recordColumns>

export type DBParcelle = SelectResultFields<typeof parcelleColumns> & {
  controlee?: boolean
  historique_cultures?: CartoBioHistoriqueCulture[]
}

export type DBOperatorRecord = DBRecord & { parcelles?: DBParcelle[] }

export type DBOperatorRecordWithParcelles = DBRecord & { parcelles: DBParcelle[] }

export type RecordInput = Partial<RecordInfos> & { parcelles: CartoBioFeatureCollectionInput }

export type PreviousParcelle = Pick<DBParcelle, 'id' | 'cultures' | 'conversion_niveau' | 'engagement_date' | 'name'>

export type RecordSummaryRow = DBRecord & {
  geojson: Record<string, unknown>
  parcelles: string
  surface: number | null
}
