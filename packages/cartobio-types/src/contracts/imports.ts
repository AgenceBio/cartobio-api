import { z } from 'zod'
import { anyGeometrySchema, bboxSchema } from './common.js'


const optionalString = (description: string) => z.string().optional().meta({ description })
const booleanString = (description: string) => optionalString(`${description} (\`true\` / \`false\`, défaut \`false\`)`)

const currentYear = new Date().getUTCFullYear()
export const geofoliaQuerySchema = z.object({
  year: z.coerce.number().int().min(currentYear - 3).max(currentYear).default(currentYear)
    .meta({ description: 'Campagne Geofolia (année courante ou l\'une des 3 précédentes)' })
})

export const evvParamsSchema = z.object({
  numeroEvv: z.string().meta({ description: 'Numéro EVV (exploitation viti-vinicole, nCVI)' }),
  numeroBio: z.coerce.number().int().meta({ description: 'Numéro bio de l\'opérateur' })
})

export const importIdParamsSchema = z.object({
  id: z.string().meta({ description: 'Identifiant du job d\'import (`jobId` retourné à l\'envoi)' })
})

export const importListQuerySchema = z.looseObject({
  status: optionalString('Statuts du job séparés par des virgules (`CREATED`, `PENDING`, `DONE`, `ERROR`)'),
  from: optionalString('Date de début d\'envoi incluse (ISO 8601)'),
  to: optionalString('Date de fin d\'envoi incluse, jusqu\'à 23:59:59 (ISO 8601)'),
  withPayload: booleanString('Inclure le corps JSON envoyé'),
  logs: optionalString('Non utilisé'),
  page: optionalString('Numéro de page, à partir de 1 (défaut 1)'),
  limit: optionalString('Nombre d\'imports par page (défaut 20)'),
  withRejected: booleanString('Uniquement les imports comportant au moins un objet refusé')
})

export const importDetailsQuerySchema = z.looseObject({
  withPayload: booleanString('Inclure le corps JSON envoyé'),
  logs: optionalString('Non utilisé')
})

export const importLogsQuerySchema = z.looseObject({
  type: optionalString('Type de log (`error`, `warning`, `all`)')
})

export const certificationParcellairesQuerySchema = z.looseObject({
  limit: optionalString('Nombre de parcellaires par page (sans limite si absent)'),
  start: optionalString('Décalage de pagination (défaut 0)'),
  anneeAudit: optionalString('Année de la date d\'audit'),
  statut: optionalString('État du parcellaire (`OPERATOR_DRAFT`, `AUDITED`, `PENDING_CERTIFICATION`, `CERTIFIED`)'),
  anneeReferenceControle: optionalString('Année de référence du contrôle')
})

export const certificationParcellaireQuerySchema = z.looseObject({
  anneeAudit: optionalString('Année de la date d\'audit'),
  statut: optionalString('État du parcellaire (`OPERATOR_DRAFT`, `AUDITED`, `PENDING_CERTIFICATION`, `CERTIFIED`)')
})

const optionalValue = <T extends z.ZodType>(schema: T, description: string) => schema.nullable().optional().meta({ description })
const optionalText = (description: string) => optionalValue(z.union([z.string(), z.number()]), description)

export const importedFeaturePropertiesSchema = z.looseObject({
  id: optionalText('Identifiant de la parcelle dans la source'),
  NOM: optionalText('Nom de la parcelle'),
  COMMUNE: optionalText('Code INSEE de la commune'),
  PACAGE: optionalText('Numéro PACAGE'),
  NUMERO_I: optionalText('Numéro d\'îlot PAC'),
  NUMERO_P: optionalText('Numéro de parcelle PAC'),
  BIO: optionalValue(z.number(), 'Parcelle déclarée en bio dans le RPG (`1`) ou non (`0`)'),
  conversion_niveau: optionalText('Niveau de conversion : `CONV`, `AB?`, `C1`, `C2`, `C3` ou `AB`'),
  engagement_date: optionalText('Date d\'engagement en bio'),
  cultures: optionalValue(z.array(z.looseObject({
    id: optionalText('Identifiant de la culture'),
    CPF: optionalText('Code CPF'),
    TYPE: optionalText('Code culture PAC')
  })), 'Cultures'),
  cadastre: optionalValue(z.array(z.string()), 'Références cadastrales')
})

export const importedFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  remoteId: z.union([z.string(), z.number()]).optional().meta({ description: 'Identifiant de la parcelle dans la source (RPG)' }),
  geometry: anyGeometrySchema.nullable().meta({ description: 'Géométrie en WGS84, `null` pour les parcelles viticoles nCVI' }),
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
