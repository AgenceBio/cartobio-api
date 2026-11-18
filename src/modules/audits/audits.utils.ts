import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { CertificationState } from '@agencebio/cartobio-types'
import type { FeatureInput, FeaturePropertiesInput } from '@agencebio/cartobio-types'
import { parcellaires, parcelles } from '../../database/schema/index.js'
import { InvalidRequestApiError } from '../../shared/errors.js'
import { parcelleUpdateSet } from '../../shared/parcellaires/parcellaires.utils.js'
import { areaHa, wgs84FromGeoJSON } from '../../database/postgis.js'

export function assertConversionNiveau(
  state: string | null | undefined,
  features: FeatureInput[],
  isCreation: boolean
): void {
  if (!state || state === CertificationState.OPERATOR_DRAFT) return
  const isMissing = features.some(({ properties }) => {
    const value = properties?.conversion_niveau
    return isCreation ? !value : value === '' || value === null
  })
  if (isMissing) throw new InvalidRequestApiError('Le niveau de conversion est obligatoire.')
}

export function geometryInput(geometry: FeatureInput['geometry'] | null | undefined): SQL {
  return geometry ? wgs84FromGeoJSON(geometry) : sql`NULL::geometry`
}

export function featureUpdateSet(
  properties: FeaturePropertiesInput,
  geometry: FeatureInput['geometry'] | null | undefined
): Record<string, SQL> {
  const geometrySql = geometryInput(geometry)
  const finalGeometry = sql`coalesce(${geometrySql}, ${parcelles.geometry})`

  return {
    ...parcelleUpdateSet(properties, finalGeometry, sql`${parcelles.etranger}`),
    geometry: finalGeometry,
    surfaceHa: sql`coalesce(${areaHa(geometrySql)}, ${parcelles.surfaceHa})`
  }
}

export const recordColumnsByLegacyName: Record<string, keyof typeof parcellaires.$inferInsert> = {
  numerobio: 'numeroBio',
  version_name: 'versionNom',
  annee_reference_controle: 'anneeReferenceControle',
  certification_date_debut: 'certificationDateDebut',
  certification_date_fin: 'certificationDateFin',
  certification_state: 'certificationEtat',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  oc_id: 'ocId',
  audit_date: 'auditDate',
  audit_notes: 'auditNotesCertif',
  audit_demandes: 'auditDemandesOperateur',
  mixite: 'mixite',
  date_derniere_notif: 'dateDerniereNotif',
  deleted_at: 'deletedAt'
}
