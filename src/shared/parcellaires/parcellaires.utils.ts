import { and, eq, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import type { PgInsertValue } from 'drizzle-orm/pg-core'
import { EventType } from '@agencebio/cartobio-types'
import type { Polygon } from 'geojson'
import type {
  CartoBioAnnotation,
  CartoBioCulture,
  CartoBioUser,
  FeaturePropertiesInput,
  HistoryEntry
} from '@agencebio/cartobio-types'
import {
  communes,
  parcelleCultures,
  parcellaires,
  parcellairesEvenements,
  parcellairesMetadata,
  parcelles,
  parcellesAnnotations,
  territoires
} from '../../database/schema/index.js'
import { areaHa, asGeoJSON } from '../../database/postgis.js'
import {
  annotationCodes,
  createParcelleAttributesSchema,
  updateParcelleSchema
} from '../../database/validations/parcelles.js'

function engagementDateAB(conversionNiveau: SQL, engagementDate: SQL): SQL {
  return sql`CASE WHEN ${conversionNiveau} = 'AB' AND ${engagementDate} IS NULL THEN DATE '1900-01-01' ELSE ${engagementDate} END`
}

export function communeLaPlusProche(geometry: SQLWrapper): SQL {
  return sql`COALESCE(
    (SELECT ${communes.fid} FROM ${communes}
      WHERE ${communes.active} AND ST_Intersects(${geometry}, ${communes.geometry})
      ORDER BY ST_Area(ST_Intersection(${geometry}, ${communes.geometry})) DESC, ST_Area(${communes.geometry}), ${communes.fid}
      LIMIT 1),
    (SELECT ${communes.fid} FROM ${communes}
      WHERE ${communes.active}
      ORDER BY ST_Distance(${geometry}, ${communes.geometry}), ${communes.fid}
      LIMIT 1)
  )`
}

function communeEtEtranger(commune: SQL, etranger: SQL, geometry: SQLWrapper): { commune: SQL; etranger: SQL } {
  const valid = sql`CASE WHEN ST_IsValid(${geometry}) THEN ${geometry} ELSE ST_MakeValid(${geometry}, 'method=structure') END`
  const horsTerritoires = sql`NOT EXISTS (SELECT 1 FROM ${territoires} WHERE ST_Intersects(${valid}, ${territoires.geometry}))`
  const renseignee = sql`nullif(${commune}, '') IS NOT NULL`

  return {
    commune: sql`CASE WHEN ${renseignee} THEN ${commune} WHEN ${horsTerritoires} THEN NULL ELSE ${communeLaPlusProche(valid)} END`,
    etranger: sql`CASE WHEN ${renseignee} THEN ${etranger} ELSE ${horsTerritoires} END`
  }
}

export function parcelleInsertValues(
  recordId: string,
  id: string,
  properties: FeaturePropertiesInput,
  geometry: SQL,
  etranger: SQL,
  from: string[] | null = null
): PgInsertValue<typeof parcelles> {
  assertParcelleProperties(properties)
  const conversionNiveau = sql`${properties.conversion_niveau || null}::cartobio.conversion_niveau`
  const localisation = communeEtEtranger(sql`${blankToNull(properties.COMMUNE)}::text`, etranger, geometry)

  return {
    ...createParcelleAttributesSchema.parse({
      recordId,
      id,
      commentaireOperateur: blankToNull(properties.commentaires),
      auditeurNotesParcelles: blankToNull(properties.auditeur_notes),
      name: blankToNull(properties.NOM),
      numeroPacage: blankToNull(properties.PACAGE),
      codeCulturePac: blankToNull(properties.TYPE),
      codePrecisionPac: blankToNull(properties.CODE_VAR),
      fromParcelles: from
    }),
    geometry,
    surfaceHa: areaHa(geometry),
    commune: localisation.commune,
    etranger: localisation.etranger,
    conversionNiveau,
    engagementDate: engagementDateAB(
      conversionNiveau,
      sql`nullif(${properties.engagement_date ?? null}::text, '')::date`
    ),
    createdAt: sql`now()`,
    updatedAt: sql`now()`,
    numeroIlotPac: sql`${blankToNull(properties.NUMERO_I)}::smallint`,
    numeroParcellesPac: sql`${blankToNull(properties.NUMERO_P)}::smallint`,
    referenceCadastre: sql`${properties.cadastre ?? null}::text[]`
  }
}

function assertParcelleProperties(properties: FeaturePropertiesInput): void {
  const values = Object.fromEntries(
    Object.entries({
      conversionNiveau: properties.conversion_niveau,
      commentaireOperateur: properties.commentaires,
      auditeurNotesParcelles: properties.auditeur_notes,
      name: properties.NOM,
      numeroPacage: properties.PACAGE,
      numeroIlotPac: properties.NUMERO_I,
      numeroParcellesPac: properties.NUMERO_P,
      referenceCadastre: properties.cadastre,
      codeCulturePac: properties.TYPE,
      codePrecisionPac: properties.CODE_VAR,
      attentePac: properties.attente_pac,
      etranger: properties.etranger
    }).filter(([, value]) => blankToNull(value) !== null)
  )

  if (Object.keys(values).length > 0) updateParcelleSchema.parse(values)
}

export function parcelleUpdateSet(
  properties: FeaturePropertiesInput,
  geometry: SQLWrapper,
  etranger: SQL
): Record<string, SQL> {
  assertParcelleProperties(properties)
  const conversionNiveau =
    properties.conversion_niveau === ''
      ? sql`NULL`
      : sql`coalesce(${properties.conversion_niveau ?? null}::cartobio.conversion_niveau, ${parcelles.conversionNiveau})`
  const localisation = communeEtEtranger(coalesceBlank(properties.COMMUNE, parcelles.commune), etranger, geometry)

  return {
    commune: localisation.commune,
    etranger: localisation.etranger,
    conversionNiveau,
    engagementDate: engagementDateAB(
      conversionNiveau,
      sql`nullif(coalesce(${properties.engagement_date ?? null}::text, ${parcelles.engagementDate}::text), '')::date`
    ),
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

export function setHistoryUsers<T extends { audit_history: HistoryEntry[] }>(
  record: T,
  users: Map<string, CartoBioUser>
): T {
  if (!record.audit_history?.length) return record

  return {
    ...record,
    audit_history: record.audit_history.map((entry) =>
      entry.user ? { ...entry, user: users.get(String(entry.user.id)) ?? entry.user } : entry
    )
  }
}

export function blankToNull<T>(value: T | null | undefined): T | null {
  return typeof value === 'string' && !value.trim() ? null : (value ?? null)
}

export function coalesceBlank(
  value: string | number | null | undefined,
  column: SQLWrapper,
  type: 'text' | 'smallint' = 'text'
): SQL {
  if (value != null && blankToNull(value) === null) return sql`NULL`
  return sql`coalesce(${value ?? null}::${sql.raw(type)}, ${column})`
}

export const INSERT_BATCH_SIZE = 1000

export function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size)
  )
}

export function notInKeys(
  parcelleIdColumn: SQLWrapper,
  idColumn: SQLWrapper,
  keys: Array<{ parcelleId: string; id: string }>
): SQL {
  return sql`(${parcelleIdColumn}, ${idColumn}) NOT IN (${sql.join(
    keys.map(({ parcelleId, id }) => sql`(${parcelleId}, ${id})`),
    sql`, `
  )})`
}

function withoutNullKeys(object: SQL): SQL {
  return sql`(SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(${object}) WHERE jsonb_typeof(value) <> 'null')`
}

function isoTimestamp(timestamp: SQLWrapper): SQL<string> {
  return sql<string>`to_char(${timestamp} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

export const recordMetadata: SQL<Record<string, unknown>> = sql<
  Record<string, unknown>
>`${withoutNullKeys(sql`jsonb_build_object(
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

const auditHistory: SQL<HistoryEntry[]> = sql<HistoryEntry[]>`COALESCE((
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

export function culturesJson(recordId: SQLWrapper, parcelleId: SQLWrapper): SQL<CartoBioCulture[]> {
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

function annotationsJson(recordId: SQLWrapper, parcelleId: SQLWrapper): SQL<CartoBioAnnotation[]> {
  return sql<CartoBioAnnotation[]>`COALESCE((
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

const legacyStatutImportGeom: SQL<string | null> = sql<
  string | null
>`CASE ${parcelles.statutImportGeom}::text WHEN 'ACCEPTE_NON_CORRIGE' THEN 'ACCEPTENONCORRIGE' ELSE ${parcelles.statutImportGeom}::text END`

export const parcelleColumns = {
  record_id: parcelles.recordId,
  id: parcelles.id,
  geometry: asGeoJSON<Polygon>(parcelles.geometry),
  commune: parcelles.commune,
  commune_label: sql<
    string | null
  >`(SELECT ${communes.nom} FROM ${communes} WHERE ${communes.fid} = ${parcelles.commune})`,
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
