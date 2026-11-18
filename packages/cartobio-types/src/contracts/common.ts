import { z } from 'zod'

export const recordIdSchema = z.guid().meta({ description: 'Identifiant du parcellaire (record_id)' })

export const recordIdParamsSchema = z.object({
  recordId: recordIdSchema
})

const isExistingDay = (value: string): boolean => {
  const day = value.slice(0, 10)
  const date = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day && !Number.isNaN(Date.parse(value))
}

export const isoDateStringSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/)
  .refine(isExistingDay, { message: 'Date invalide' })

export const optionalIsoDateQuerySchema = z.preprocess((value) => value === '' ? undefined : value, isoDateStringSchema.optional())

export const integerStringSchema = z.string().regex(/^\d+$/)

export const pageStringSchema = z.string().regex(/^[1-9]\d*$/)

export const dateTimeSchema = z.union([z.date(), z.string()]).meta({ description: 'Date au format ISO 8601' })

export const bboxSchema = z.array(z.number()).optional().meta({ description: 'Emprise GeoJSON' })

export const outputGeometrySchema = z.object({
  type: z.string().meta({ description: 'Type de géométrie GeoJSON', examples: ['Polygon'] }),
  coordinates: z.array(z.unknown()),
  bbox: bboxSchema
})

export const anyGeometrySchema = z.union([
  outputGeometrySchema,
  z.object({
    type: z.literal('GeometryCollection'),
    geometries: z.array(z.unknown()),
    bbox: bboxSchema
  })
])

export const positionSchema = z.array(z.number()).min(2).max(3).meta({ description: 'Position GeoJSON : [x, y] ou [x, y, z]' })

export const geometrySchema = z.looseObject({
  type: z.string(),
  coordinates: z.array(z.unknown())
}).meta({ description: 'Géométrie GeoJSON (validée finement par PostGIS)' })

export const validationIssueSchema = z.object({
  location: z.string().meta({ description: 'Partie de la requête concernée : body, querystring, params ou headers' }),
  path: z.string().meta({ description: 'Chemin du champ en erreur, ex. parcelles.features.0.properties.NUMERO_I' }),
  message: z.string()
})

export const apiErrorSchema = z.object({
  statusCode: z.number(),
  code: z.string().optional(),
  error: z.string().meta({ description: 'Libellé HTTP du statut' }),
  message: z.string(),
  details: z.array(validationIssueSchema).optional().meta({ description: 'Champs en erreur, pour les erreurs de validation' })
})

export type ApiError = z.infer<typeof apiErrorSchema>
export type ValidationIssue = z.infer<typeof validationIssueSchema>
export type RecordIdParams = z.infer<typeof recordIdParamsSchema>
export type Position = z.infer<typeof positionSchema>
