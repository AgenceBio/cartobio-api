import { z } from 'zod'
import { anyGeometrySchema, bboxSchema, geometrySchema, positionSchema } from './common.js'

export const borderCutBodySchema = z
  .object({
    geometry: geometrySchema,
    distance: z.number().meta({ description: 'Largeur de la bordure, en mètres' }),
    allBorder: z
      .boolean()
      .meta({ description: 'Toute la bordure, ou seulement entre `startBorderPoint` et `endBorderPoint`' }),
    isInverted: z.boolean().meta({ description: 'Inverse le côté de la bordure entre les deux points' }),
    startBorderPoint: positionSchema
      .optional()
      .meta({ description: 'Point de début [lng, lat], requis si `allBorder` est faux' }),
    endBorderPoint: positionSchema
      .optional()
      .meta({ description: 'Point de fin [lng, lat], requis si `allBorder` est faux' })
  })
  .refine((body) => body.allBorder || (body.startBorderPoint && body.endBorderPoint), {
    message: 'Les deux points sont requis',
    path: ['endBorderPoint']
  })

export const geometryEqualsBodySchema = z.object({
  payload: z.object({
    old: z
      .guid()
      .meta({
        description: "Premier parcellaire (record_id). L'ordre chronologique est recalculé à partir des dates d'audit"
      }),
    new: z.guid().meta({ description: 'Second parcellaire (record_id)' })
  })
})

export const addGeometryBodySchema = z.object({
  payload: z
    .object({
      geometry: z.unknown().optional(),
      properties: z
        .object({
          id: z
            .union([z.string(), z.number()])
            .optional()
            .meta({ description: "Parcelle en cours d'édition, exclue de la détection" })
        })
        .optional()
    })
    .meta({ description: 'Feature GeoJSON à vérifier' })
})

export const borderCutResponseSchema = z.object({
  parcelleSansBordure: z.unknown().meta({ description: 'Géométrie GeoJSON de la parcelle sans la bordure' }),
  bordure: z.unknown().meta({ description: 'Géométrie GeoJSON de la bordure' })
})

export const geometryEqualsResponseSchema = z.array(
  z.object({
    comparison_result: z
      .string()
      .nullable()
      .meta({ description: 'Ordre chronologique des deux parcellaires comparés' }),
    geojson: z
      .object({
        type: z.literal('FeatureCollection'),
        features: z.array(
          z.object({
            type: z.literal('Feature'),
            geometry: anyGeometrySchema.nullable(),
            properties: z
              .looseObject({
                status: z
                  .string()
                  .nullable()
                  .optional()
                  .meta({ description: 'Nature de la différence : ajout, suppression ou modification' }),
                new_id: z.union([z.string(), z.number()]).nullable().optional(),
                old_id: z.union([z.string(), z.number()]).nullable().optional(),
                label: z.string().nullable().optional(),
                old_label: z.string().nullable().optional()
              })
              .nullable(),
            bbox: bboxSchema
          })
        ),
        bbox: bboxSchema
      })
      .meta({ description: 'Différences géométriques entre les deux parcellaires' })
  })
)

const correctionSchema = z.object({
  id: z.string().meta({ description: 'Parcelle existante en chevauchement' }),
  new_minus_intersection: anyGeometrySchema.nullable().meta({ description: 'Nouvelle parcelle sans la zone commune' }),
  existing_minus_intersection: anyGeometrySchema
    .nullable()
    .meta({ description: 'Parcelle existante sans la zone commune' }),
  intersection: anyGeometrySchema.nullable().meta({ description: 'Zone commune' })
})

export const addGeometryResponseSchema = z.object({
  valid: z.boolean().meta({ description: "La géométrie ne chevauche ni n'inclut aucune autre parcelle" }),
  corrections: z
    .array(correctionSchema)
    .optional()
    .meta({ description: 'Corrections proposées en cas de chevauchement' })
})

export type BorderCutBody = z.infer<typeof borderCutBodySchema>
export type GeometryEqualsBody = z.infer<typeof geometryEqualsBodySchema>
export type AddGeometryBody = z.infer<typeof addGeometryBodySchema>
export type BorderCutResponse = z.infer<typeof borderCutResponseSchema>
export type GeometryEqualsResponse = z.infer<typeof geometryEqualsResponseSchema>
export type AddGeometryResponse = z.infer<typeof addGeometryResponseSchema>
