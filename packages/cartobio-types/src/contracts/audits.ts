import { z } from 'zod'
import { bboxSchema as outputBboxSchema, dateTimeSchema, outputGeometrySchema } from './common.js'

const bboxSchema = z.union([
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
])

const polygonSchema = z.looseObject({
  type: z.literal('Polygon').optional(),
  coordinates: z.array(z.array(z.array(z.number()))).optional(),
  bbox: bboxSchema.optional()
})

export const cultureSchema = z.looseObject({
  id: z.string().regex(/^.*-.*-.*-.*-.*$/).optional(),
  CPF: z.string().nullish(),
  TYPE: z.string().nullish(),
  variete: z.string().nullish(),
  surface: z.union([z.number(), z.string()]).nullish(),
  unit: z.enum(['%', 'ha']).nullish(),
  date_semis: z.string().nullish()
})

const historiqueCultureSchema = z.looseObject({
  cultures: z.array(cultureSchema).nullish(),
  annee_controle: z.number().nullish(),
  conversion_niveau: z.string().nullish()
})

export const featurePropertiesSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  COMMUNE_LABEL: z.string().nullish(),
  COMMUNE: z.string().nullish(),
  cultures: z.array(cultureSchema).nullish(),
  conversion_niveau: z.string().nullish(),
  engagement_date: z.string().nullish(),
  commentaires: z.string().nullish(),
  auditeur_notes: z.string().nullish(),
  annotations: z.unknown().optional(),
  NOM: z.string().nullish(),
  PACAGE: z.string().nullish(),
  NUMERO_I: z.union([z.string(), z.number()]).nullish(),
  NUMERO_P: z.union([z.string(), z.number()]).nullish(),
  cadastre: z.array(z.string()).nullish(),
  etranger: z.boolean().nullish(),
  statut_import_geom: z.string().nullish(),
  TYPE: z.string().nullish(),
  CODE_VAR: z.string().nullish(),
  CODE_CULTURE: z.string().nullish(),
  CODE_PRECISION: z.string().nullish(),
  controlee: z.boolean().nullish(),
  historique: z.array(historiqueCultureSchema).nullish(),
  attente_pac: z.boolean().nullish(),
  CPF: z.string().nullish(),
  SURF: z.number().nullish(),
  variete: z.string().nullish()
})

export const featureSchema = z.looseObject({
  type: z.literal('Feature').optional(),
  geometry: polygonSchema.optional(),
  id: z.union([z.string(), z.number()]).optional(),
  properties: featurePropertiesSchema.optional(),
  bbox: bboxSchema.optional()
})

export const featureCollectionSchema = z.looseObject({
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
  pac: z.string().optional().meta({ description: 'Cherche l\'attestation PAC complète plutôt que l\'attestation complète (`true` / `false`)' })
})

export const recordInfosBodySchema = z.looseObject({
  audit_date: z.iso.date().nullish().meta({ description: 'Date de l\'audit' }),
  audit_notes: z.string().nullish().meta({ description: 'Notes de l\'auditeur' }),
  audit_demandes: z.string().nullish().meta({ description: 'Demandes formulées à l\'opérateur lors de l\'audit' }),
  certification_date_debut: z.iso.date().nullish().meta({ description: 'Début de validité de la certification' }),
  certification_date_fin: z.iso.date().nullish().meta({ description: 'Fin de validité de la certification' })
})

const createRecordFeatureSchema = featureSchema.extend({
  geometry: polygonSchema.extend({ coordinates: z.array(z.array(z.array(z.number()))) }).optional(),
  properties: featurePropertiesSchema
}).transform(({ geometry, ...feature }) => ({
  ...feature,
  type: 'Feature' as const,
  geometry: geometry ? { ...geometry, type: 'Polygon' as const } : null
}))

const createRecordFeatureCollectionSchema = featureCollectionSchema.extend({
  features: z.array(createRecordFeatureSchema)
}).transform((featureCollection) => ({ ...featureCollection, type: 'FeatureCollection' as const }))

export const createRecordBodySchema = recordInfosBodySchema.extend({
  parcelles: createRecordFeatureCollectionSchema,
  metadata: z.looseObject({}).optional().meta({ description: 'Métadonnées de l\'import (source, provenance…)' }),
  version_name: z.string().nullish().transform((versionName) => versionName ?? undefined).meta({ description: 'Nom de la version du parcellaire' }),
  reference_annee_controle: z.int().nullish().meta({ description: 'Année de référence du contrôle' }),
  importPrevious: z.boolean().nullish().transform((importPrevious) => importPrevious ?? undefined).meta({ description: 'Recopie les données (cultures, conversion, nom…) des parcelles du parcellaire `recordId`' }),
  recordId: z.string().nullish().transform((recordId) => recordId ?? undefined).meta({ description: 'Parcellaire précédent dont recopier les données' })
})

export const createFeatureBodySchema = z.looseObject({
  feature: featureSchema
})

export const deleteFeatureBodySchema = z.looseObject({
  reason: z.looseObject({
    code: z.enum(['lifecycle', 'other', 'error']).meta({ description: 'Motif : fin de vie de la parcelle, erreur de saisie ou autre' }),
    reason: z.string().nullish().meta({ description: 'Précision libre' })
  }).meta({ description: 'Motif de suppression, conservé dans l\'historique' })
})

export const createFeaturesFromOtherBodySchema = z.looseObject({
  features: z.unknown().optional().meta({ description: 'Nouvelles parcelles (features GeoJSON)' }),
  from: z.unknown().optional().meta({ description: 'Identifiants des parcelles remplacées : supprimées et référencées comme origine des nouvelles' })
})

const opt = <T extends z.ZodType>(schema: T, description: string) => schema.nullable().optional().meta({ description })
const text = (description: string) => opt(z.string(), description)
const textOrNumber = (description: string) => opt(z.union([z.string(), z.number()]), description)

export const recordCultureSchema = z.looseObject({
  id: textOrNumber('Identifiant de la culture'),
  CPF: text('Code CPF'),
  TYPE: text('Code culture PAC'),
  variete: text('Variété'),
  surface: textOrNumber('Surface de la culture'),
  unit: text('Unité de la surface : `ha` ou `%`'),
  date_semis: opt(dateTimeSchema, 'Date de semis')
})

export const recordFeaturePropertiesSchema = z.looseObject({
  id: textOrNumber('Identifiant de la parcelle'),
  NOM: text('Nom de la parcelle'),
  COMMUNE: text('Code INSEE de la commune'),
  COMMUNE_LABEL: text('Nom de la commune'),
  cultures: opt(z.array(recordCultureSchema), 'Cultures'),
  conversion_niveau: text('Niveau de conversion : `CONV`, `AB?`, `C1`, `C2`, `C3` ou `AB`'),
  engagement_date: opt(dateTimeSchema, 'Date d\'engagement en bio'),
  commentaires: text('Commentaire de l\'opérateur'),
  auditeur_notes: text('Notes de l\'auditeur'),
  annotations: opt(z.array(z.unknown()), 'Annotations de l\'auditeur'),
  PACAGE: textOrNumber('Numéro PACAGE'),
  NUMERO_I: textOrNumber('Numéro d\'îlot PAC'),
  NUMERO_P: textOrNumber('Numéro de parcelle PAC'),
  cadastre: opt(z.array(z.string()), 'Références cadastrales'),
  CODE_CULTURE: text('Code culture PAC'),
  CODE_PRECISION: text('Code précision PAC'),
  createdAt: opt(dateTimeSchema, 'Date de création'),
  updatedAt: opt(dateTimeSchema, 'Date de dernière modification'),
  etranger: opt(z.boolean(), 'Parcelle hors de France'),
  controlee: opt(z.boolean(), 'Parcelle marquée comme contrôlée par l\'utilisateur'),
  historique: opt(z.array(z.unknown()), 'Cultures et niveaux de conversion des années précédentes'),
  attente_pac: opt(z.boolean(), 'Parcelle en attente de la déclaration PAC')
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

export const normalizedRecordSchema = z.looseObject({
  record_id: z.string().meta({ description: 'Identifiant du parcellaire' }),
  numerobio: textOrNumber('Numéro bio'),
  version_name: text('Nom de la version'),
  certification_state: text('État : `OPERATOR_DRAFT`, `AUDITED`, `PENDING_CERTIFICATION` ou `CERTIFIED`'),
  annee_reference_controle: opt(z.number(), 'Année de référence du contrôle'),
  audit_date: opt(dateTimeSchema, 'Date d\'audit'),
  certification_date_debut: opt(dateTimeSchema, 'Début de validité de la certification'),
  certification_date_fin: opt(dateTimeSchema, 'Fin de validité de la certification'),
  created_at: opt(dateTimeSchema, 'Date de création'),
  updated_at: opt(dateTimeSchema, 'Date de dernière modification'),
  oc_id: opt(z.number(), 'Identifiant de l\'OC'),
  oc_label: text('Nom de l\'OC'),
  audit_notes: text('Notes de l\'audit, masquées aux autres OC et à l\'opérateur'),
  audit_demandes: text('Demandes formulées lors de l\'audit'),
  audit_history: opt(z.array(z.unknown()), 'Historique des événements'),
  mixite: text('Mixité : `AB`, `ABCONV` ou `MIXTE`'),
  metadata: opt(z.unknown(), 'Métadonnées (source de l\'import…)'),
  parcelles: recordFeatureCollectionSchema
})

export const attestationProductionResponseSchema = z.object({
  hasAttestationProduction: z.boolean().meta({ description: 'Une attestation de production valide existe' })
})

export const featureControlResponseSchema = z.object({
  controlee: z.boolean().meta({ description: 'Nouvel état de contrôle de la parcelle' })
})

export type CultureInput = z.infer<typeof cultureSchema>
export type FeaturePropertiesInput = z.infer<typeof featurePropertiesSchema>
export type FeatureInput = z.infer<typeof featureSchema>
export type FeatureCollectionInput = z.infer<typeof featureCollectionSchema>
export type AuditParams = z.infer<typeof auditParamsSchema>
export type RecordInfosBody = z.infer<typeof recordInfosBodySchema>
export type CreateRecordBody = z.infer<typeof createRecordBodySchema>
export type CreateFeatureBody = z.infer<typeof createFeatureBodySchema>
export type DeleteFeatureBody = z.infer<typeof deleteFeatureBodySchema>
