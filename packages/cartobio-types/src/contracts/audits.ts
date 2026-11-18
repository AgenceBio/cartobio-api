import { z } from 'zod'
import { booleanQuery, mixiteSchema, opt, text, textOrNumber } from './helpers.js'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { CertificationState, EventType, MetadataSource } from '../enums.js'
import { cartobioUserSchema } from './auth.js'
import {
  bboxSchema as outputBboxSchema,
  isoDateSchema,
  isoDateStringSchema,
  isoDateTimeSchema,
  outputGeometrySchema
} from './common.js'

const bboxSchema = z.union([
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
])

const smallintSchema = z.union([
  z.int().min(0).max(32767),
  z
    .string()
    .regex(/^\d{0,5}$/)
    .refine((value) => Number(value) <= 32767)
])

const conversionNiveauSchema = z
  .enum(['AB', 'AB?', 'C1', 'C2', 'C3', 'CONV', ''])
  .meta({ description: "Niveau de conversion : `CONV`, `AB?`, `C1`, `C2`, `C3`, `AB`, ou `''` pour l'effacer" })

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
  bbox: bboxSchema.optional()
})

export const cultureSchema = z.object({
  id: z
    .string()
    .regex(/^.*-.*-.*-.*-.*$/)
    .optional(),
  CPF: z.string().max(64).nullish(),
  TYPE: z.string().max(64).nullish(),
  variete: z.string().max(255).nullish(),
  surface: z.union([z.number(), z.string()]).nullish(),
  unit: z.enum(['%', 'ha']).nullish(),
  date_semis: z.string().max(32).nullish(),
  commentaire: z.string().max(5000).nullish()
})

const historiqueCultureSchema = z.object({
  cultures: z.array(cultureSchema).nullish(),
  annee_controle: z.number().nullish(),
  conversion_niveau: z.string().max(255).nullish()
})

const boundedJson = <T extends z.ZodType>(schema: T): T =>
  schema.refine((value) => value === undefined || JSON.stringify(value).length <= 10_000, {
    message: 'Les métadonnées ne doivent pas dépasser 10 Ko'
  })

export const annotationSchema = z.object({
  id: z.string().max(255).optional(),
  code: z.string().max(255).optional(),
  date: z.string().max(255).nullish(),
  metadata: boundedJson(z.unknown()).optional()
})

export const featurePropertiesSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  createdAt: z.string().max(255).nullish(),
  updatedAt: z.string().max(255).nullish(),
  COMMUNE_LABEL: z.string().max(255).nullish(),
  COMMUNE: z.string().max(5).nullish(),
  cultures: z.array(cultureSchema).nullish(),
  conversion_niveau: conversionNiveauSchema.nullish(),
  engagement_date: isoDateStringSchema.or(z.literal('')).nullish(),
  commentaires: z.string().max(10000).nullish(),
  auditeur_notes: z.string().max(10000).nullish(),
  annotations: z.array(annotationSchema).nullish(),
  NOM: z.string().max(1000).nullish(),
  PACAGE: z
    .string()
    .regex(/^\d{0,9}$/)
    .nullish(),
  NUMERO_I: smallintSchema.nullish(),
  NUMERO_P: smallintSchema.nullish(),
  cadastre: z.array(z.string().max(255)).nullish(),
  etranger: z.boolean().nullish(),
  statut_import_geom: z.enum(['ACCEPTE', 'CORRIGE', 'ACCEPTENONCORRIGE', 'ACCEPTE_NON_CORRIGE']).nullish(),
  TYPE: z.string().max(255).nullish(),
  CODE_VAR: z.string().max(255).nullish(),
  CODE_CULTURE: z.string().max(255).nullish(),
  CODE_PRECISION: z.string().max(255).nullish(),
  controlee: z.boolean().nullish(),
  historique: z.array(historiqueCultureSchema).nullish(),
  attente_pac: z.boolean().nullish(),
  CPF: z.string().max(255).nullish(),
  SURF: z.number().nullish(),
  variete: z.string().max(255).nullish()
})

export const featureSchema = z.object({
  type: z.literal('Feature').optional(),
  geometry: polygonSchema.optional(),
  id: z.union([z.string(), z.number()]).optional(),
  properties: featurePropertiesSchema.optional(),
  bbox: bboxSchema.optional()
})

const newFeatureSchema = featureSchema.extend({
  geometry: polygonSchema
})

export const featureCollectionSchema = z.object({
  type: z.literal('FeatureCollection').optional(),
  features: z.array(featureSchema).optional(),
  bbox: bboxSchema.optional()
})

export const auditParamsSchema = z.object({
  recordId: z.guid().meta({ description: 'Identifiant du parcellaire (record_id)' }),
  featureId: z.string().optional().meta({ description: 'Identifiant de la parcelle' }),
  id: z.string().optional().meta({ description: 'Identifiant de la parcelle' })
})

export const controleeParamsSchema = auditParamsSchema.required({ id: true })

export const featureParamsSchema = auditParamsSchema.required({ featureId: true })

export const attestationProductionQuerySchema = z.object({
  pac: booleanQuery("Cherche l'attestation PAC complète plutôt que l'attestation complète")
})

export const recordInfosBodySchema = z.object({
  audit_date: z.iso.date().nullish().meta({ description: "Date de l'audit" }),
  audit_notes: z.string().max(10000).nullish().meta({ description: "Notes de l'auditeur" }),
  audit_demandes: z
    .string()
    .max(10000)
    .nullish()
    .meta({ description: "Demandes formulées à l'opérateur lors de l'audit" }),
  certification_date_debut: z.iso.date().nullish().meta({ description: 'Début de validité de la certification' }),
  certification_date_fin: z.iso.date().nullish().meta({ description: 'Fin de validité de la certification' }),
  certification_state: z
    .enum(CertificationState)
    .optional()
    .meta({ description: 'État du parcellaire ; un changement est historisé' }),
  mixite: mixiteSchema.nullish().meta({ description: "Mixité de l'exploitation" }),
  version_name: z.string().max(255).optional().meta({ description: 'Nom de la version du parcellaire' }),
  annee_reference_controle: z.int().optional().meta({ description: 'Année de référence du contrôle' })
})

const createRecordFeatureSchema = featureSchema
  .extend({
    geometry: polygonSchema.optional(),
    properties: featurePropertiesSchema
  })
  .transform(({ geometry, ...feature }) => ({
    ...feature,
    type: 'Feature' as const,
    geometry: geometry ? { ...geometry, type: 'Polygon' as const } : null
  }))

const createRecordFeatureCollectionSchema = featureCollectionSchema
  .extend({
    features: z.array(createRecordFeatureSchema)
  })
  .transform((featureCollection) => ({ ...featureCollection, type: 'FeatureCollection' as const }))

export const createRecordBodySchema = recordInfosBodySchema.extend({
  parcelles: createRecordFeatureCollectionSchema,
  metadata: boundedJson(
    z.looseObject({
      source: z.enum(MetadataSource).nullish().meta({ description: "Source de l'import" })
    })
  )
    .optional()
    .meta({ description: "Métadonnées de l'import (source, provenance…)" }),
  version_name: z
    .string()
    .max(255)
    .nullish()
    .transform((versionName) => versionName ?? undefined)
    .meta({ description: 'Nom de la version du parcellaire' }),
  reference_annee_controle: z.int().nullish().meta({ description: 'Année de référence du contrôle' }),
  importPrevious: z
    .boolean()
    .nullish()
    .transform((importPrevious) => importPrevious ?? undefined)
    .meta({ description: 'Recopie les données (cultures, conversion, nom…) des parcelles du parcellaire `recordId`' }),
  recordId: z
    .string()
    .nullish()
    .transform((recordId) => recordId ?? undefined)
    .meta({ description: 'Parcellaire précédent dont recopier les données' })
})

export const patchRecordBodySchema = z.strictObject(recordInfosBodySchema.shape)
export const patchFeatureBodySchema = z.strictObject(featureSchema.shape)
export const patchFeatureCollectionBodySchema = z.strictObject(featureCollectionSchema.shape)

export const createFeatureBodySchema = z.strictObject({
  feature: newFeatureSchema
})

export const deleteFeatureBodySchema = z.strictObject({
  reason: z
    .object({
      code: z
        .enum(['lifecycle', 'other', 'error'])
        .meta({ description: 'Motif : fin de vie de la parcelle, erreur de saisie ou autre' }),
      reason: z.string().max(10000).nullish().meta({ description: 'Précision libre' })
    })
    .meta({ description: "Motif de suppression, conservé dans l'historique" })
})

export const createFeaturesFromOtherBodySchema = z.strictObject({
  features: z.array(newFeatureSchema).meta({ description: 'Nouvelles parcelles (features GeoJSON)' }),
  from: z.array(z.union([z.string(), z.number()])).meta({
    description: 'Identifiants des parcelles remplacées : supprimées et référencées comme origine des nouvelles'
  })
})

export const historyEntrySchema = z.looseObject({
  type: z.enum(EventType).meta({ description: "Type d'événement" }),
  state: z.string().optional().meta({ description: "État de certification après l'événement" }),
  date: isoDateTimeSchema.meta({ description: "Date de l'événement" }),
  metadata: z.record(z.string(), z.unknown()).optional().meta({ description: "Données associées à l'événement" }),
  description: z.string().optional().meta({ description: "Description de l'événement" }),
  user: cartobioUserSchema
    .partial()
    .extend({ id: z.union([z.number(), z.string()]) })
    .optional()
    .meta({ description: "Auteur de l'événement" }),
  featureIds: z
    .array(z.union([z.string(), z.number()]).nullish())
    .nullish()
    .meta({ description: 'Parcelles concernées' })
})

export const recordCultureSchema = z.looseObject({
  id: z.string().meta({ description: 'Identifiant de la culture' }),
  CPF: z.string().optional().meta({ description: 'Code CPF' }),
  TYPE: text('Code culture PAC'),
  variete: text('Variété'),
  surface: textOrNumber('Surface de la culture'),
  unit: text('Unité de la surface : `ha` ou `%`'),
  date_semis: opt(isoDateSchema, 'Date de semis'),
  commentaire: text('Commentaire')
})

export const recordHistoriqueCultureSchema = z.looseObject({
  cultures: z.array(recordCultureSchema).meta({ description: "Cultures de l'année" }),
  conversion_niveau: z.string().nullable().meta({ description: "Niveau de conversion de l'année" }),
  annee_controle: z.number().meta({ description: 'Année de référence du contrôle' })
})

export const recordAnnotationSchema = z.looseObject({
  id: z.string().meta({ description: "Identifiant de l'annotation" }),
  code: z.string().meta({ description: "Code de l'annotation" }),
  date: isoDateTimeSchema.meta({ description: "Date de l'annotation" }),
  metadata: z.unknown().optional().meta({ description: "Données associées à l'annotation" })
})

export const recordFeaturePropertiesSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).meta({ description: 'Identifiant de la parcelle' }),
  NOM: text('Nom de la parcelle'),
  COMMUNE: text('Code INSEE de la commune'),
  COMMUNE_LABEL: z.string().optional().meta({ description: 'Nom de la commune' }),
  cultures: z.array(recordCultureSchema).meta({ description: 'Cultures' }),
  conversion_niveau: text('Niveau de conversion : `CONV`, `AB?`, `C1`, `C2`, `C3` ou `AB`'),
  engagement_date: opt(isoDateSchema, "Date d'engagement en bio"),
  commentaires: text("Commentaire de l'opérateur"),
  auditeur_notes: text("Notes de l'auditeur"),
  annotations: opt(z.array(recordAnnotationSchema), "Annotations de l'auditeur"),
  PACAGE: text('Numéro PACAGE'),
  NUMERO_I: textOrNumber("Numéro d'îlot PAC"),
  NUMERO_P: textOrNumber('Numéro de parcelle PAC'),
  cadastre: opt(z.array(z.string()), 'Références cadastrales'),
  CODE_CULTURE: text('Code culture PAC'),
  CODE_PRECISION: text('Code précision PAC'),
  createdAt: opt(isoDateTimeSchema, 'Date de création'),
  updatedAt: opt(isoDateTimeSchema, 'Date de dernière modification'),
  etranger: z.boolean().meta({ description: 'Parcelle hors de France' }),
  controlee: z.boolean().meta({ description: "Parcelle marquée comme contrôlée par l'utilisateur" }),
  historique: opt(z.array(recordHistoriqueCultureSchema), 'Cultures et niveaux de conversion des années précédentes'),
  attente_pac: z.boolean().meta({ description: 'Parcelle en attente de la déclaration PAC' })
})

export const recordFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: outputGeometrySchema.nullable(),
  properties: recordFeaturePropertiesSchema,
  bbox: outputBboxSchema
})

export const recordFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(recordFeatureSchema),
  bbox: outputBboxSchema
})

export const recordInfosSchema = z.looseObject({
  record_id: z.string().meta({ description: 'Identifiant du parcellaire' }),
  numerobio: z.string().meta({ description: 'Numéro bio' }),
  version_name: z.string().meta({ description: 'Nom de la version' }),
  certification_state: z.enum(CertificationState).meta({ description: 'État du parcellaire' }),
  annee_reference_controle: z.number().meta({ description: 'Année de référence du contrôle' }),
  audit_date: isoDateSchema.nullable().meta({ description: "Date d'audit" }),
  certification_date_debut: isoDateSchema.nullable().meta({ description: 'Début de validité de la certification' }),
  certification_date_fin: isoDateSchema.nullable().meta({ description: 'Fin de validité de la certification' }),
  created_at: isoDateTimeSchema.meta({ description: 'Date de création' }),
  updated_at: isoDateTimeSchema.meta({ description: 'Date de dernière modification' }),
  oc_id: z.number().nullable().meta({ description: "Identifiant de l'OC" }),
  oc_label: text("Nom de l'OC"),
  audit_notes: z.string().nullable().meta({ description: "Notes de l'audit, masquées aux autres OC et à l'opérateur" }),
  audit_demandes: z.string().nullable().meta({ description: "Demandes formulées lors de l'audit" }),
  audit_history: z.array(historyEntrySchema).meta({ description: 'Historique des événements' }),
  mixite: mixiteSchema.nullable().meta({ description: "Mixité de l'exploitation" }),
  metadata: z.record(z.string(), z.unknown()).meta({ description: "Métadonnées (source de l'import…)" })
})

export const normalizedRecordSchema = recordInfosSchema.extend({
  parcelles: recordFeatureCollectionSchema
})

export const attestationProductionResponseSchema = z.object({
  hasAttestationProduction: z.boolean().meta({ description: 'Une attestation de production valide existe' })
})

export const featureControlResponseSchema = z.object({
  controlee: z.boolean().meta({ description: 'Nouvel état de contrôle de la parcelle' })
})

export type HistoryEntry = z.infer<typeof historyEntrySchema>
export type CartoBioCulture = z.infer<typeof recordCultureSchema>
export type CartoBioAnnotation = z.infer<typeof recordAnnotationSchema>
export type CartoBioHistoriqueCulture = z.infer<typeof recordHistoriqueCultureSchema>
export type CartoBioFeatureProperties = z.infer<typeof recordFeaturePropertiesSchema>
export type CartoBioFeature = z.infer<typeof recordFeatureSchema>
export type CartoBioFeatureCollection = z.infer<typeof recordFeatureCollectionSchema>
export type RecordInfos = z.infer<typeof recordInfosSchema>
export type NormalizedRecord = z.infer<typeof normalizedRecordSchema>
export type CultureInput = z.infer<typeof cultureSchema>
export type FeaturePropertiesInput = z.infer<typeof featurePropertiesSchema>
export type FeatureInput = z.infer<typeof featureSchema>
export type FeatureCollectionInput = z.infer<typeof featureCollectionSchema>
export type AuditParams = z.infer<typeof auditParamsSchema>
export type RecordInfosBody = z.infer<typeof recordInfosBodySchema>
export type CreateRecordBody = z.infer<typeof createRecordBodySchema>
export type CreateFeatureBody = z.infer<typeof createFeatureBodySchema>
export type DeleteFeatureBody = z.infer<typeof deleteFeatureBodySchema>
export type CartoBioFeatureInput = Feature<Polygon | null, FeaturePropertiesInput>
export type CartoBioFeatureCollectionInput = FeatureCollection<Polygon | null, FeaturePropertiesInput>
export type AttestationProductionResponse = z.infer<typeof attestationProductionResponseSchema>
export type FeatureControlResponse = z.infer<typeof featureControlResponseSchema>
