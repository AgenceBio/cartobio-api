import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { CertificationState } from '@agencebio/cartobio-types'
import type { FeatureInput, FeaturePropertiesInput } from '@agencebio/cartobio-types'
import { parcellaires, parcelles } from '../../database/schema/index.js'
import { InvalidRequestApiError } from '../../shared/errors.js'
import { coalesceBlank } from '../../shared/parcellaires/parcellaires.utils.js'

export const mixiteParcelles: SQL<string | null> = sql<string | null>`CASE
  WHEN COUNT(*) FILTER (WHERE ${parcelles.conversionNiveau} = 'AB') = COUNT(*) THEN 'AB'
  WHEN COUNT(*) FILTER (WHERE ${parcelles.conversionNiveau} IN ('C1', 'C2', 'C3', 'AB')) = COUNT(*) THEN 'ABCONV'
  WHEN COUNT(*) FILTER (WHERE ${parcelles.conversionNiveau} = 'CONV') > 0 THEN 'MIXTE'
END`

export function assertConversionNiveau (state: string | null | undefined, features: FeatureInput[], isCreation: boolean): void {
  if (!state || state === CertificationState.OPERATOR_DRAFT) return
  const isMissing = features.some(({ properties }) => {
    const value = properties?.conversion_niveau
    return isCreation ? !value : value === '' || value === null
  })
  if (isMissing) throw new InvalidRequestApiError('Le niveau de conversion est obligatoire.')
}

export function geometryInput (geometry: FeatureInput['geometry'] | null | undefined): SQL {
  return geometry ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)` : sql`NULL::geometry`
}

export function featureUpdateSet (properties: FeaturePropertiesInput, geometry: FeatureInput['geometry'] | null | undefined): Record<string, SQL> {
  const geometrySql = geometryInput(geometry)

  return {
    geometry: sql`coalesce(${geometrySql}, ${parcelles.geometry})`,
    surfaceHa: sql`coalesce(round((ST_Area(${geometrySql}::geography) / 10000)::numeric, 4), ${parcelles.surfaceHa})`,
    commune: coalesceBlank(properties.COMMUNE, parcelles.commune),
    conversionNiveau: properties.conversion_niveau === ''
      ? sql`NULL`
      : sql`coalesce(${properties.conversion_niveau ?? null}::cartobio.conversion_niveau, ${parcelles.conversionNiveau})`,
    engagementDate: sql`nullif(coalesce(${properties.engagement_date ?? null}::text, ${parcelles.engagementDate}::text), '')::date`,
    commentaireOperateur: coalesceBlank(properties.commentaires, parcelles.commentaireOperateur),
    auditeurNotesParcelles: coalesceBlank(properties.auditeur_notes, parcelles.auditeurNotesParcelles),
    updatedAt: sql`now()`,
    name: coalesceBlank(properties.NOM, parcelles.name),
    numeroPacage: coalesceBlank(properties.PACAGE, parcelles.numeroPacage),
    numeroIlotPac: coalesceBlank(properties.NUMERO_I, parcelles.numeroIlotPac, 'smallint'),
    numeroParcellesPac: coalesceBlank(properties.NUMERO_P, parcelles.numeroParcellesPac, 'smallint'),
    referenceCadastre: sql`coalesce(${properties.cadastre ?? null}::text[], ${parcelles.referenceCadastre})`,
    codeCulturePac: coalesceBlank(properties.TYPE, parcelles.codeCulturePac),
    codePrecisionPac: coalesceBlank(properties.CODE_VAR, parcelles.codePrecisionPac)
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
