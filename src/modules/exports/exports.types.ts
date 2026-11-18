import type { CartoBioCulture } from '@agencebio/cartobio-types'
import type { parcellaires, parcelles } from '../../database/schema/index.js'

type Parcellaire = typeof parcellaires.$inferSelect
type Parcelle = typeof parcelles.$inferSelect

export type ConversionNiveau = NonNullable<Parcelle['conversionNiveau']>

export type AttestationProduction = {
  path: string
}

export type ArchiveOperator = {
  annee_reference_controle: number | string | null
  numeroBio: string
}

export type ExportRow = {
  record_id: string
  numerobio: number
  version_name: string
  source: string | null
  provenance: string | null
  campagne: string | null
  created_at: Date
  updated_at: Date
  mixite: Parcellaire['mixite']
  anneereference: number
  certification_state: Parcellaire['certificationEtat']
  audit_date: string | null
  audit_notes: string | null
  certification_date_debut: string | null
  certification_date_fin: string | null
  nombre_parcelles: number
  superficie_totale_ha: number
  surface_conventionnel_ha: number
  surface_c1_ha: number
  surface_c2_ha: number
  surface_c3_ha: number
  surface_ab_ha: number
}

export type PdfRecord = {
  version_name: string
  audit_date: string | null
  annee_reference_controle: number
  mixite: Parcellaire['mixite']
  oc_label: string | null
  certification_date_debut: string | null
  certification_date_fin: string | null
  numeros_pacage: string | null
}

export type PdfParcelle = {
  id: string
  name: string | null
  cultures: CartoBioCulture[]
  conversion_niveau: Parcelle['conversionNiveau']
  commune: string | null
  communename: string
  created: Date
  engagement_date: string | null
  nbilot: string | null
  nbp: string | null
  refcad: string[] | null
  geojson: string
  minx: number
  miny: number
  maxx: number
  maxy: number
  centerx: number
  centery: number
  superficie_totale_ha: number
}

export type BoundingBox = {
  minx: number
  miny: number
  maxx: number
  maxy: number
  centerx: number
  centery: number
  width: number
  height: number
}

export type MapDrawOptions = {
  width: number
  height: number
  center: [number, number]
  zoom: number
  timeout: number
}

export type MapDrawResult = {
  buffer?: string
  error?: string
  err?: unknown
}

export type MapImagesOptions = {
  width?: number
  height?: number
  timeout?: number
}

export type OperatorMapImages = {
  global: { buffer: string | undefined } | null
  parcelles: Array<{ id: string, buffer: string | undefined }>
}
