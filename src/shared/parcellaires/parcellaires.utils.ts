import { and, eq, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import { EventType } from '@agencebio/cartobio-types'
import type { CartoBioCulture, CartoBioUser, HistoryEntry } from '@agencebio/cartobio-types'
import {
  parcelleCultures,
  parcellaires,
  parcellairesEvenements,
  parcellairesMetadata,
  parcelles,
  parcellesAnnotations
} from '../../database/schema/index.js'
import { asGeoJSON } from '../../database/postgis.js'
import { annotationCodes } from '../../database/validations/parcelles.js'

export function setHistoryUsers<T extends { audit_history: HistoryEntry[] }> (record: T, users: Map<string, CartoBioUser>): T {
  if (!record.audit_history?.length) return record

  return {
    ...record,
    audit_history: record.audit_history.map((entry) => entry.user
      ? { ...entry, user: users.get(String(entry.user.id)) ?? entry.user }
      : entry
    )
  }
}

export function blankToNull<T> (value: T | null | undefined): T | null {
  return typeof value === 'string' && !value.trim() ? null : value ?? null
}

export function coalesceBlank (value: string | number | null | undefined, column: SQLWrapper, type: 'text' | 'smallint' = 'text'): SQL {
  if (value != null && blankToNull(value) === null) return sql`NULL`
  return sql`coalesce(${value ?? null}::${sql.raw(type)}, ${column})`
}

export function withoutNullKeys (object: SQL): SQL {
  return sql`(SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(${object}) WHERE jsonb_typeof(value) <> 'null')`
}

export function isoTimestamp (timestamp: SQLWrapper): SQL<string> {
  return sql<string>`to_char(${timestamp} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

export const recordMetadata: SQL<Record<string, unknown>> = sql<Record<string, unknown>>`${withoutNullKeys(sql`jsonb_build_object(
  'source', ${parcellairesMetadata.source},
  'sourceLastUpdate', ${isoTimestamp(parcellairesMetadata.sourceUpdatedAt)},
  'provenance', ${parcellairesMetadata.provenance},
  'campagne', ${parcellairesMetadata.campagne}::text,
  'pacage', ${parcellairesMetadata.numeroPacage},
  'anneeAssolement', ${parcellairesMetadata.anneeAssolement},
  'copy_of', ${parcellairesMetadata.copyOf},
  'warnings', ${parcellairesMetadata.warnings}
)`)}`

const legacyEventType = sql.join(
  Object.entries(EventType).map(([type, legacy]) => sql`WHEN ${type} THEN ${legacy}::text`),
  sql` `
)

export const eventTypes: Record<string, keyof typeof EventType> = Object.fromEntries(
  Object.entries(EventType).map(([type, legacy]) => [legacy, type as keyof typeof EventType])
)

export const auditHistory: SQL<HistoryEntry[]> = sql<HistoryEntry[]>`COALESCE((
  SELECT jsonb_agg(${withoutNullKeys(sql`jsonb_build_object(
    'type', CASE ${parcellairesEvenements.type}::text ${legacyEventType} END,
    'state', ${parcellairesEvenements.certificationEtat},
    'date', ${isoTimestamp(parcellairesEvenements.date)},
    'description', ${parcellairesEvenements.description},
    'metadata', ${parcellairesEvenements.metadata},
    'featureIds', to_jsonb(${parcellairesEvenements.parcellesId}),
    'user', CASE WHEN ${parcellairesEvenements.userId} IS NOT NULL
      THEN jsonb_build_object('id', ${parcellairesEvenements.userId}, 'mainGroup', jsonb_build_object('nom', ${parcellairesEvenements.userRole}))
    END
  )`)} ORDER BY ${parcellairesEvenements.date})
  FROM ${parcellairesEvenements}
  WHERE ${eq(parcellairesEvenements.recordId, parcellaires.recordId)}
), '[]'::jsonb)`

export const recordColumns = {
  record_id: parcellaires.recordId,
  numerobio: sql<string>`${parcellaires.numeroBio}::text`,
  version_name: parcellaires.versionNom,
  annee_reference_controle: parcellaires.anneeReferenceControle,
  certification_date_debut: parcellaires.certificationDateDebut,
  certification_date_fin: parcellaires.certificationDateFin,
  certification_state: parcellaires.certificationEtat,
  created_at: isoTimestamp(parcellaires.createdAt),
  updated_at: isoTimestamp(parcellaires.updatedAt),
  oc_id: sql<number | null>`${parcellaires.ocId}::int`,
  metadata: recordMetadata,
  audit_date: parcellaires.auditDate,
  audit_history: auditHistory,
  audit_notes: parcellaires.auditNotesCertif,
  audit_demandes: parcellaires.auditDemandesOperateur,
  mixite: parcellaires.mixite
}

export function culturesJson (recordId: SQLWrapper, parcelleId: SQLWrapper): SQL<CartoBioCulture[]> {
  return sql<CartoBioCulture[]>`COALESCE((
    SELECT jsonb_agg(${withoutNullKeys(sql`jsonb_build_object(
      'id', ${parcelleCultures.id}::text,
      'CPF', ${parcelleCultures.cpf},
      'TYPE', ${parcelleCultures.codeCultureImport},
      'variete', ${parcelleCultures.variete},
      'surface', ${parcelleCultures.surface},
      'unit', ${parcelleCultures.unit},
      'date_semis', ${parcelleCultures.dateSemis},
      'commentaire', ${parcelleCultures.commentaire}
    )`)} ORDER BY ${parcelleCultures.position})
    FROM ${parcelleCultures}
    WHERE ${and(eq(parcelleCultures.recordId, recordId), eq(parcelleCultures.parcelleId, parcelleId))}
  ), '[]'::jsonb)`
}

const legacyAnnotationCode = sql.join(
  Object.entries(annotationCodes).map(([code, type]) => sql`WHEN ${type} THEN ${code}::text`),
  sql` `
)

export function annotationsJson (recordId: SQLWrapper, parcelleId: SQLWrapper): SQL<object[]> {
  return sql<object[]>`COALESCE((
    SELECT jsonb_agg(${withoutNullKeys(sql`jsonb_build_object(
      'id', ${parcellesAnnotations.id},
      'code', CASE ${parcellesAnnotations.typeAnnot}::text ${legacyAnnotationCode} END,
      'date', ${isoTimestamp(parcellesAnnotations.createdAt)},
      'metadata', ${parcellesAnnotations.metadata}
    )`)} ORDER BY ${parcellesAnnotations.createdAt})
    FROM ${parcellesAnnotations}
    WHERE ${and(eq(parcellesAnnotations.recordId, recordId), eq(parcellesAnnotations.parcelleId, parcelleId))}
  ), '[]'::jsonb)`
}

export const legacyStatutImportGeom: SQL<string | null> = sql<string | null>`CASE ${parcelles.statutImportGeom}::text WHEN 'ACCEPTE_NON_CORRIGE' THEN 'ACCEPTENONCORRIGE' ELSE ${parcelles.statutImportGeom}::text END`

export const parcelleColumns = {
  record_id: parcelles.recordId,
  id: parcelles.id,
  geometry: asGeoJSON(parcelles.geometry),
  commune: parcelles.commune,
  cultures: culturesJson(parcelles.recordId, parcelles.id),
  conversion_niveau: parcelles.conversionNiveau,
  engagement_date: parcelles.engagementDate,
  commentaire: parcelles.commentaireOperateur,
  auditeur_notes: parcelles.auditeurNotesParcelles,
  annotations: annotationsJson(parcelles.recordId, parcelles.id),
  created: isoTimestamp(parcelles.createdAt),
  updated: isoTimestamp(parcelles.updatedAt),
  name: parcelles.name,
  numero_pacage: parcelles.numeroPacage,
  numero_ilot_pac: sql<string | null>`${parcelles.numeroIlotPac}::text`,
  numero_parcelle_pac: sql<string | null>`${parcelles.numeroParcellesPac}::text`,
  reference_cadastre: parcelles.referenceCadastre,
  code_culture_pac: parcelles.codeCulturePac,
  code_precision_pac: parcelles.codePrecisionPac,
  etranger: parcelles.etranger,
  statut_import_geom: legacyStatutImportGeom,
  attente_pac: parcelles.attentePac,
  from_parcelles: parcelles.fromParcelles,
  deleted_at: parcelles.deletedAt
}
