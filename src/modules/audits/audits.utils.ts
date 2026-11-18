import { lt, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { CertificationState } from '@agencebio/cartobio-types'
import type {
  AgenceBioNormalizedOperator,
  CartoBioUser,
  FeatureInput,
  FeaturePropertiesInput,
  NormalizedRecord
} from '@agencebio/cartobio-types'
import type { DBOperatorRecordWithParcelles } from '../../shared/parcellaires/parcellaires.types.js'
import { maskOcAgents } from '../../shared/outputs/history.js'
import { normalizeRecord, redactAuditNotes } from '../../shared/outputs/record.js'
import { parcellaires, parcelles } from '../../database/schema/index.js'
import { InvalidRequestApiError, PreconditionFailedApiError } from '../../shared/errors.js'
import { parcelleUpdateSet } from '../../shared/parcellaires/parcellaires.utils.js'
import { areaHa, wgs84FromGeoJSON } from '../../database/postgis.js'
import { isOperatorUser } from '../auth/auth.utils.js'

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

export function outputRecord(
  user: CartoBioUser | null,
  record: DBOperatorRecordWithParcelles,
  operator?: AgenceBioNormalizedOperator | null
): NormalizedRecord {
  const normalized = normalizeRecord(record)
  if (isOperatorUser(user)) normalized.audit_notes = null
  if (user?.organismeCertificateur && normalized.oc_id !== user.organismeCertificateur.id) redactAuditNotes(normalized)
  return maskOcAgents(
    normalized,
    { user, ocId: user?.organismeCertificateur?.id },
    operator?.organismeCertificateur?.id
  )
}

export function unmodifiedSinceCondition(ifUnmodifiedSince: string | undefined): SQL | undefined {
  if (!ifUnmodifiedSince || Number.isNaN(Date.parse(ifUnmodifiedSince))) return undefined
  return lt(parcellaires.updatedAt, new Date(Math.floor(Date.parse(ifUnmodifiedSince) / 1000) * 1000 + 1000))
}

export function assertUnmodified(updatedRows: unknown[]): void {
  if (updatedRows.length === 0)
    throw new PreconditionFailedApiError('Le contenu a été modifié depuis votre dernière requête.')
}

export function geometryInput(geometry: FeatureInput['geometry'] | null | undefined): SQL {
  return geometry ? wgs84FromGeoJSON(geometry) : sql`NULL::geometry`
}

export function featureUpdateSet(
  properties: FeaturePropertiesInput,
  geometry: FeatureInput['geometry'] | null | undefined
): PgUpdateSetSource<typeof parcelles> {
  if (!geometry) return parcelleUpdateSet(properties, parcelles.geometry, parcelles.etranger)

  const geometrySql = wgs84FromGeoJSON(geometry)
  return {
    ...parcelleUpdateSet(properties, geometrySql, parcelles.etranger),
    geometry: geometrySql,
    surfaceHa: areaHa(geometrySql)
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
