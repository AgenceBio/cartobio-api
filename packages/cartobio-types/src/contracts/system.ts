import { z } from 'zod'

export const versionResponseSchema = z.object({
  version: z.string().meta({ description: 'Version de l\'API déployée', examples: ['2.42.0'] })
})

export const testResponseSchema = z.object({
  message: z.string().meta({ examples: ['OK'] })
})

const healthBaseSchema = z.object({
  status: z.literal('ok').meta({ description: 'Le processus API répond' }),
  uptime: z.number().meta({ description: 'Durée de fonctionnement du processus, en secondes' }),
  timestamp: z.number().meta({ description: 'Horodatage de la réponse, en millisecondes depuis epoch' })
})

export const healthAvailableResponseSchema = healthBaseSchema.extend({
  db: z.literal('ok').meta({ description: 'La base PostgreSQL est joignable' })
})

export const healthUnavailableResponseSchema = healthBaseSchema.extend({
  db: z.literal('unreachable').meta({ description: 'La base PostgreSQL est injoignable' })
})

export const healthResponseSchema = z.union([healthAvailableResponseSchema, healthUnavailableResponseSchema])

export type VersionResponse = z.infer<typeof versionResponseSchema>
export type TestResponse = z.infer<typeof testResponseSchema>
export type HealthAvailableResponse = z.infer<typeof healthAvailableResponseSchema>
export type HealthUnavailableResponse = z.infer<typeof healthUnavailableResponseSchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
