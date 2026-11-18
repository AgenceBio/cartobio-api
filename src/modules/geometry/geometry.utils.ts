import type { Feature, Geometry } from 'geojson'
import type { parcellaires, parcelles } from '../../database/schema/index.js'

export type ComparisonResult = 'r1_old_r2_new' | 'r2_old_r1_new'
type ParcellaireDates = Pick<typeof parcellaires.$inferSelect, 'auditDate' | 'anneeReferenceControle' | 'createdAt'>
type ParcelleLabel = Pick<typeof parcelles.$inferSelect, 'numeroIlotPac' | 'numeroParcellesPac' | 'name'>

export function compareParcellaires (r1: ParcellaireDates, r2: ParcellaireDates): ComparisonResult {
  const anneeControle = ({ auditDate, anneeReferenceControle }: ParcellaireDates): number =>
    auditDate ? Number(auditDate.slice(0, 4)) : anneeReferenceControle

  const ordre = r1.auditDate && r2.auditDate
    ? r1.auditDate.localeCompare(r2.auditDate)
    : anneeControle(r1) - anneeControle(r2)

  return (ordre || r1.createdAt.getTime() - r2.createdAt.getTime()) < 0 ? 'r1_old_r2_new' : 'r2_old_r1_new'
}

export function label ({ numeroIlotPac, numeroParcellesPac, name }: ParcelleLabel): string {
  return numeroIlotPac !== null
    ? `Ilot ${numeroIlotPac} Parcelle ${numeroParcellesPac ?? '?'}`
    : name ?? 'Parcelle'
}

export function feature (geometry: Geometry | null, properties: Record<string, unknown>): Feature {
  return { type: 'Feature', properties, geometry: geometry as Geometry }
}
