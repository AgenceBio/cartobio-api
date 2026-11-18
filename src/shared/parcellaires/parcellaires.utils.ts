import { eq, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import type { PgColumn, PgInsertValue, PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { EventType, toIsoDate, toIsoDateTime } from '@agencebio/cartobio-types'
import type { IsoDate, IsoDateTime } from '@agencebio/cartobio-types'
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
import type { DBParcelle, ParcelleRow } from './parcellaires.types.js'
import {
  annotationCodes,
  createParcelleAttributesSchema,
  updateParcelleSchema
} from '../../database/validations/parcelles.js'

export function engagementDateAB(conversionNiveau: string | null, engagementDate: string | null): string | null {
  return conversionNiveau === 'AB' && engagementDate === null ? '1900-01-01' : engagementDate
}

function engagementDateUpdate(
  conversionNiveau: string | null | undefined,
  engagementDate: string | null | undefined
): string | null | SQL | undefined {
  if (conversionNiveau !== undefined && engagementDate !== undefined)
    return engagementDateAB(conversionNiveau, engagementDate)
  if (engagementDate) return engagementDate
  if (conversionNiveau === 'AB') return sql`coalesce(${parcelles.engagementDate}, DATE '1900-01-01')`
  if (conversionNiveau !== undefined) return undefined
  if (engagementDate === null) return sql`CASE WHEN ${parcelles.conversionNiveau} = 'AB' THEN DATE '1900-01-01' END`
  return sql`CASE WHEN ${parcelles.conversionNiveau} = 'AB' AND ${parcelles.engagementDate} IS NULL THEN DATE '1900-01-01' ELSE ${parcelles.engagementDate} END`
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

function communeEtEtranger<E extends boolean | SQLWrapper>(
  commune: string | null | SQLWrapper,
  etranger: E,
  geometry: SQLWrapper
): { commune: string | SQL; etranger: E | SQL } {
  if (typeof commune === 'string') return { commune, etranger }

  const valid = sql`CASE WHEN ST_IsValid(${geometry}) THEN ${geometry} ELSE ST_MakeValid(${geometry}, 'method=structure') END`
  const horsTerritoires = sql`NOT EXISTS (SELECT 1 FROM ${territoires} WHERE ST_Intersects(${valid}, ${territoires.geometry}))`
  const communeCalculee = sql`CASE WHEN ${horsTerritoires} THEN NULL ELSE ${communeLaPlusProche(valid)} END`

  if (commune === null) return { commune: communeCalculee, etranger: horsTerritoires }

  const renseignee = sql`nullif(${commune}, '') IS NOT NULL`
  return {
    commune: sql`CASE WHEN ${renseignee} THEN ${commune} ELSE ${communeCalculee} END`,
    etranger: sql`CASE WHEN ${renseignee} THEN ${etranger} ELSE ${horsTerritoires} END`
  }
}

export function parcelleInsertValues(
  recordId: string,
  id: string,
  properties: FeaturePropertiesInput,
  geometry: SQL,
  etranger: boolean,
  from: string[] | null = null
): PgInsertValue<typeof parcelles> {
  const conversionNiveau = blankToNull(properties.conversion_niveau)
  const localisation = communeEtEtranger(blankToNull(properties.COMMUNE), etranger, geometry)

  return {
    ...createParcelleAttributesSchema.parse({
      recordId,
      id,
      conversionNiveau,
      engagementDate: engagementDateAB(conversionNiveau, blankToNull(properties.engagement_date)),
      commentaireOperateur: blankToNull(properties.commentaires),
      auditeurNotesParcelles: blankToNull(properties.auditeur_notes),
      name: blankToNull(properties.NOM),
      numeroPacage: blankToNull(properties.PACAGE),
      numeroIlotPac: blankToNull(properties.NUMERO_I),
      numeroParcellesPac: blankToNull(properties.NUMERO_P),
      referenceCadastre: properties.cadastre ?? null,
      codeCulturePac: blankToNull(properties.TYPE),
      codePrecisionPac: blankToNull(properties.CODE_VAR),
      fromParcelles: from
    }),
    geometry,
    surfaceHa: areaHa(geometry),
    commune: localisation.commune,
    etranger: localisation.etranger
  }
}

export function parcelleUpdateSet(
  properties: FeaturePropertiesInput,
  geometry: SQLWrapper,
  etranger: boolean | PgColumn
): PgUpdateSetSource<typeof parcelles> {
  const values = definedOnly({
    conversionNiveau: updatedValue(properties.conversion_niveau),
    engagementDate: updatedValue(properties.engagement_date),
    commentaireOperateur: updatedValue(properties.commentaires),
    auditeurNotesParcelles: updatedValue(properties.auditeur_notes),
    name: updatedValue(properties.NOM),
    numeroPacage: updatedValue(properties.PACAGE),
    numeroIlotPac: updatedValue(properties.NUMERO_I),
    numeroParcellesPac: updatedValue(properties.NUMERO_P),
    referenceCadastre: properties.cadastre ?? undefined,
    codeCulturePac: updatedValue(properties.TYPE),
    codePrecisionPac: updatedValue(properties.CODE_VAR)
  })
  const parsed = Object.keys(values).length > 0 ? updateParcelleSchema.parse(values) : {}
  const commune = updatedValue(properties.COMMUNE)
  const localisation = communeEtEtranger(commune === undefined ? parcelles.commune : commune, etranger, geometry)

  return definedOnly({
    ...parsed,
    commune: localisation.commune,
    etranger: localisation.etranger,
    engagementDate: engagementDateUpdate(parsed.conversionNiveau, parsed.engagementDate)
  })
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

export function updatedValue<T>(value: T | null | undefined): T | null | undefined {
  return value == null ? undefined : blankToNull(value)
}

export function definedOnly<T extends Record<string, unknown>>(
  values: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
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

export function isoTimestamp(timestamp: SQLWrapper): SQL<IsoDateTime> {
  return sql<IsoDateTime>`to_char(${timestamp} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

export function isoDay(date: SQLWrapper): SQL<IsoDate | null> {
  return sql<IsoDate | null>`to_char(${date}, 'YYYY-MM-DD')`
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
  certification_date_debut: isoDay(parcellaires.certificationDateDebut),
  certification_date_fin: isoDay(parcellaires.certificationDateFin),
  certification_state: parcellaires.certificationEtat,
  created_at: isoTimestamp(parcellaires.createdAt),
  updated_at: isoTimestamp(parcellaires.updatedAt),
  oc_id: parcellaires.ocId,
  metadata: recordMetadata,
  audit_date: isoDay(parcellaires.auditDate),
  audit_history: auditHistory,
  audit_notes: parcellaires.auditNotesCertif,
  audit_demandes: parcellaires.auditDemandesOperateur,
  mixite: parcellaires.mixite
}

export function withoutNulls<T extends Record<string, unknown>>(values: T): T {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value != null)) as T
}

const annotationCodeByType = Object.fromEntries(
  Object.entries(annotationCodes).map(([code, type]) => [type, code])
) as Record<string, string | undefined>

export function toCulture(row: typeof parcelleCultures.$inferSelect): CartoBioCulture {
  return withoutNulls({
    id: row.id,
    CPF: row.cpf,
    TYPE: row.codeCultureImport,
    variete: row.variete,
    surface: row.surface === null ? null : Number(row.surface),
    unit: row.unit,
    date_semis: row.dateSemis,
    commentaire: row.commentaire
  }) as CartoBioCulture
}

export function toAnnotation(row: typeof parcellesAnnotations.$inferSelect): CartoBioAnnotation {
  return withoutNulls({
    id: row.id,
    code: annotationCodeByType[row.typeAnnot],
    date: toIsoDateTime(row.createdAt),
    metadata: row.metadata
  }) as CartoBioAnnotation
}

export function parcelleKey(recordId: string, parcelleId: string): string {
  return `${recordId}/${parcelleId}`
}

export function toDBParcelle(
  row: ParcelleRow,
  cultures: CartoBioCulture[],
  annotations: CartoBioAnnotation[]
): DBParcelle {
  return {
    ...row,
    cultures,
    annotations,
    engagement_date: row.engagement_date === null ? null : toIsoDate(row.engagement_date),
    created: toIsoDateTime(row.created),
    updated: toIsoDateTime(row.updated),
    numero_ilot_pac: row.numero_ilot_pac === null ? null : String(row.numero_ilot_pac),
    numero_parcelle_pac: row.numero_parcelle_pac === null ? null : String(row.numero_parcelle_pac),
    statut_import_geom: row.statut_import_geom === 'ACCEPTE_NON_CORRIGE' ? 'ACCEPTENONCORRIGE' : row.statut_import_geom
  }
}

export const parcelleColumns = {
  record_id: parcelles.recordId,
  id: parcelles.id,
  geometry: asGeoJSON<Polygon>(parcelles.geometry),
  commune: parcelles.commune,
  commune_label: communes.nom,
  conversion_niveau: parcelles.conversionNiveau,
  engagement_date: parcelles.engagementDate,
  commentaire: parcelles.commentaireOperateur,
  auditeur_notes: parcelles.auditeurNotesParcelles,
  created: parcelles.createdAt,
  updated: parcelles.updatedAt,
  name: parcelles.name,
  numero_pacage: parcelles.numeroPacage,
  numero_ilot_pac: parcelles.numeroIlotPac,
  numero_parcelle_pac: parcelles.numeroParcellesPac,
  reference_cadastre: parcelles.referenceCadastre,
  code_culture_pac: parcelles.codeCulturePac,
  code_precision_pac: parcelles.codePrecisionPac,
  etranger: parcelles.etranger,
  statut_import_geom: parcelles.statutImportGeom,
  attente_pac: parcelles.attentePac,
  from_parcelles: parcelles.fromParcelles,
  deleted_at: parcelles.deletedAt
}
