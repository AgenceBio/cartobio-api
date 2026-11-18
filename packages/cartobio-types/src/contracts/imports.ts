import { z } from 'zod'
import { booleanQuery, opt, optionalString, textOrNumber } from './helpers.js'
import {
  anyGeometrySchema,
  bboxSchema,
  integerStringSchema,
  optionalIsoDateQuerySchema,
  pageStringSchema
} from './common.js'

const currentYear = new Date().getUTCFullYear()
export const geofoliaQuerySchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(currentYear - 3)
    .max(currentYear)
    .default(currentYear)
    .meta({ description: "Campagne Geofolia (année courante ou l'une des 3 précédentes)" })
})

export const evvParamsSchema = z.object({
  numeroEvv: z.string().meta({ description: 'Numéro EVV (exploitation viti-vinicole, nCVI)' }),
  numeroBio: z.coerce.number().int().meta({ description: "Numéro bio de l'opérateur" })
})

export const importIdParamsSchema = z.object({
  id: z.string().meta({ description: "Identifiant du job d'import (`jobId` retourné à l'envoi)" })
})

export const importListQuerySchema = z.object({
  status: optionalString('Statuts du job séparés par des virgules (`CREATED`, `PENDING`, `DONE`, `ERROR`)'),
  from: optionalIsoDateQuerySchema.meta({ description: "Date de début d'envoi incluse (ISO 8601)" }),
  to: optionalIsoDateQuerySchema.meta({ description: "Date de fin d'envoi incluse, jusqu'à 23:59:59 (ISO 8601)" }),
  withPayload: booleanQuery('Inclure le corps JSON envoyé'),
  logs: optionalString('Non utilisé'),
  page: pageStringSchema.optional().meta({ description: 'Numéro de page, à partir de 1 (défaut 1)' }),
  limit: integerStringSchema.optional().meta({ description: "Nombre d'imports par page (défaut 20)" }),
  withRejected: booleanQuery('Uniquement les imports comportant au moins un objet refusé')
})

export const importDetailsQuerySchema = z.object({
  withPayload: booleanQuery('Inclure le corps JSON envoyé'),
  logs: optionalString('Non utilisé')
})

export const certificationParcellairesQuerySchema = z.object({
  limit: integerStringSchema
    .optional()
    .meta({ description: 'Nombre de parcellaires par page (sans limite si absent)' }),
  start: integerStringSchema.optional().meta({ description: 'Décalage de pagination (défaut 0)' }),
  anneeAudit: optionalString("Année de la date d'audit"),
  statut: optionalString('État du parcellaire (`OPERATOR_DRAFT`, `AUDITED`, `PENDING_CERTIFICATION`, `CERTIFIED`)'),
  anneeReferenceControle: integerStringSchema.optional().meta({ description: 'Année de référence du contrôle' })
})

export const certificationParcellaireQuerySchema = z.object({
  anneeAudit: optionalString("Année de la date d'audit"),
  statut: optionalString('État du parcellaire (`OPERATOR_DRAFT`, `AUDITED`, `PENDING_CERTIFICATION`, `CERTIFIED`)')
})

export const importedFeaturePropertiesSchema = z.looseObject({
  id: textOrNumber('Identifiant de la parcelle dans la source'),
  NOM: textOrNumber('Nom de la parcelle'),
  COMMUNE: textOrNumber('Code INSEE de la commune'),
  PACAGE: textOrNumber('Numéro PACAGE'),
  NUMERO_I: textOrNumber("Numéro d'îlot PAC"),
  NUMERO_P: textOrNumber('Numéro de parcelle PAC'),
  BIO: opt(z.number(), 'Parcelle déclarée en bio dans le RPG (`1`) ou non (`0`)'),
  conversion_niveau: textOrNumber('Niveau de conversion : `CONV`, `AB?`, `C1`, `C2`, `C3` ou `AB`'),
  engagement_date: textOrNumber("Date d'engagement en bio"),
  cultures: opt(
    z.array(
      z.looseObject({
        id: textOrNumber('Identifiant de la culture'),
        CPF: textOrNumber('Code CPF'),
        TYPE: textOrNumber('Code culture PAC')
      })
    ),
    'Cultures'
  ),
  cadastre: opt(z.array(z.string()), 'Références cadastrales')
})

export const importedFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  remoteId: z
    .union([z.string(), z.number()])
    .optional()
    .meta({ description: 'Identifiant de la parcelle dans la source (RPG)' }),
  geometry: anyGeometrySchema
    .nullable()
    .meta({ description: 'Géométrie en WGS84, `null` pour les parcelles viticoles nCVI' }),
  properties: importedFeaturePropertiesSchema.nullable(),
  bbox: bboxSchema
})

export const importedFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(importedFeatureSchema),
  bbox: bboxSchema
})

export type GeofoliaQuery = z.infer<typeof geofoliaQuerySchema>
export type EvvParams = z.infer<typeof evvParamsSchema>
export type ImportListQuery = z.infer<typeof importListQuerySchema>
export type CertificationParcellairesQuery = z.infer<typeof certificationParcellairesQuerySchema>
