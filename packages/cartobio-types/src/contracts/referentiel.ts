import { z } from 'zod'

export const departementsResponseSchema = z
  .record(
    z.string(),
    z.array(
      z.object({
        code: z.string().meta({ description: 'Code du département' }),
        nom: z.string().meta({ description: 'Nom du département' })
      })
    )
  )
  .meta({ description: 'Départements par région (clé : nom de la région)' })

export type DepartementsResponse = z.infer<typeof departementsResponseSchema>
