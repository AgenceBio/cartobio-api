import type { Polygon } from 'geojson'
import type { SelectResultFields } from 'drizzle-orm/query-builders/select.types'
import type {
  CartoBioAnnotation,
  CartoBioCulture,
  CartoBioFeatureCollectionInput,
  CartoBioHistoriqueCulture,
  IsoDate,
  IsoDateTime,
  RecordInfos
} from '@agencebio/cartobio-types'
import type { parcelleColumns, recordColumns } from './parcellaires.utils.js'

export type GeometryAnalysis = {
  statut: 'ACCEPTE' | 'UNCORRECTABLE' | 'ACCEPTENONCORRIGE' | 'CORRIGE'
  etranger: boolean | null
  geometry: Polygon | null
  commune: string | null
}

type DBRecord = SelectResultFields<typeof recordColumns>

export type ParcelleRow = Omit<SelectResultFields<typeof parcelleColumns>, 'commune_label'> & {
  commune_label: string | null
}

export type DBParcelle = Omit<
  ParcelleRow,
  'engagement_date' | 'created' | 'updated' | 'numero_ilot_pac' | 'numero_parcelle_pac' | 'statut_import_geom'
> & {
  cultures: CartoBioCulture[]
  annotations: CartoBioAnnotation[]
  engagement_date: IsoDate | null
  created: IsoDateTime
  updated: IsoDateTime
  numero_ilot_pac: string | null
  numero_parcelle_pac: string | null
  statut_import_geom: string | null
  controlee?: boolean
  historique_cultures?: CartoBioHistoriqueCulture[]
}

export type DBOperatorRecord = DBRecord & { parcelles?: DBParcelle[] }

export type DBOperatorRecordWithParcelles = DBRecord & { parcelles: DBParcelle[] }

type PlainDate<V> = V extends IsoDate | IsoDateTime ? string : V

export type RecordInput = Partial<{ [K in keyof RecordInfos]: PlainDate<RecordInfos[K]> }> & {
  parcelles: CartoBioFeatureCollectionInput
  numero_client?: string | null
}

export type PreviousParcelle = Pick<DBParcelle, 'id' | 'cultures' | 'conversion_niveau' | 'engagement_date' | 'name'>

export type RecordSummaryRow = DBRecord & {
  geojson: Record<string, unknown>
  parcelles: string
  surface: number | null
}
