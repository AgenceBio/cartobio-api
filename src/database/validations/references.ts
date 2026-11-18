import { createInsertSchema } from 'drizzle-orm/zod'
import { organismeCertificateur } from '../schema/references.js'

export const createOrganismeCertificateurSchema = createInsertSchema(organismeCertificateur, {
  id: (schema) => schema.positive(),
  label: (schema) => schema.trim().min(1)
})
  .pick({
    id: true,
    label: true
  })
  .strict()
