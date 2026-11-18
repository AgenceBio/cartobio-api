import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { EventType } from '@agencebio/cartobio-types'
import type { HistoryEntry } from '@agencebio/cartobio-types'
import {
  organismeCertificateur,
  parcellaireImportPayload,
  parcellaires,
  parcellairesEvenements,
  parcellaireImport,
  parcellairesMetadata
} from '../../database/schema/index.js'
import type { ImportJobListRow, OperatorRecordFilters } from './imports.types.js'

export const importJobColumns = {
  jobid: parcellaireImport.id,
  status: parcellaireImport.status,
  created_at: parcellaireImport.createdAt,
  ended_at: parcellaireImport.endedAt,
  numerobio: parcellaireImport.numeroBio,
  numeroclient: parcellaireImport.numeroClient,
  audit_date: parcellaireImport.auditDate,
  result_job: parcellaireImport.resultJob
}

export function payloadColumn (includePayload: boolean): SQL<ImportJobListRow['payload']> {
  return includePayload
    ? sql`json_build_object('id', ${parcellaireImportPayload.id}, 'payload', ${parcellaireImportPayload.payload})`
    : sql`NULL`
}

const ancienTypeEvenement = sql.join(
  Object.entries(EventType).map(([type, ancien]) => sql`WHEN ${type} THEN ${ancien}::text`),
  sql` `
)

export const operatorRecordColumns = {
  record_id: parcellaires.recordId,
  numerobio: sql<string>`${parcellaires.numeroBio}::text`,
  version_name: parcellaires.versionNom,
  annee_reference_controle: parcellaires.anneeReferenceControle,
  certification_date_debut: parcellaires.certificationDateDebut,
  certification_date_fin: parcellaires.certificationDateFin,
  certification_state: parcellaires.certificationEtat,
  created_at: sql<string>`${parcellaires.createdAt}`,
  updated_at: sql<string>`${parcellaires.updatedAt}`,
  oc_id: sql<number | null>`${parcellaires.ocId}`.mapWith(Number),
  oc_label: organismeCertificateur.label,
  metadata: sql<Record<string, unknown>>`jsonb_strip_nulls(jsonb_build_object(
    'source', ${parcellairesMetadata.source},
    'sourceLastUpdate', ${parcellairesMetadata.sourceUpdatedAt},
    'provenance', ${parcellairesMetadata.provenance},
    'campagne', ${parcellairesMetadata.campagne}::text,
    'pacage', ${parcellairesMetadata.numeroPacage},
    'anneeAssolement', ${parcellairesMetadata.anneeAssolement}::text
  ))`,
  audit_date: parcellaires.auditDate,
  audit_history: sql<HistoryEntry[]>`COALESCE((
    SELECT json_agg(json_strip_nulls(json_build_object(
      'type', CASE ${parcellairesEvenements.type}::text ${ancienTypeEvenement} END,
      'state', ${parcellairesEvenements.certificationEtat},
      'date', ${parcellairesEvenements.date},
      'user', CASE WHEN ${parcellairesEvenements.userId} IS NOT NULL
        THEN json_build_object('id', ${parcellairesEvenements.userId}, 'mainGroup', json_build_object('nom', ${parcellairesEvenements.userRole}))
      END,
      'featureIds', ${parcellairesEvenements.parcellesId}
    )) ORDER BY ${parcellairesEvenements.date})
    FROM ${parcellairesEvenements}
    WHERE ${eq(parcellairesEvenements.recordId, parcellaires.recordId)}
  ), '[]'::json)`,
  audit_notes: parcellaires.auditNotesCertif,
  audit_demandes: parcellaires.auditDemandesOperateur,
  mixite: parcellaires.mixite
}

export function operatorRecordConditions ({ anneeAudit, statut, anneeReferenceControle }: OperatorRecordFilters): SQL[] {
  const conditions: SQL[] = []

  if (anneeAudit) {
    conditions.push(sql`EXTRACT(YEAR FROM ${parcellaires.auditDate}) = ${Number(anneeAudit)}`)
  }

  if (statut) {
    conditions.push(sql`${parcellaires.certificationEtat}::text = ${statut}`)
  }

  if (anneeReferenceControle) {
    conditions.push(eq(parcellaires.anneeReferenceControle, Number(anneeReferenceControle)))
  }

  return conditions
}
