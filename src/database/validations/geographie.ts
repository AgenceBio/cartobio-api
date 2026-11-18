import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod'
import { communes, departements, regions, territoires } from '../schema/geographie.js'

export const createRegionSchema = createInsertSchema(regions, {
  code: (schema) => schema.trim().min(1),
  nom: (schema) => schema.trim().min(1)
})
  .omit({ geometry: true })
  .strict()

export const createDepartementSchema = createInsertSchema(departements, {
  fid: (schema) => schema.trim().min(1),
  nom: (schema) => schema.trim().min(1),
  codeRegion: (schema) => schema.trim().min(1)
})
  .omit({ geometry: true })
  .strict()

export const createCommuneSchema = createInsertSchema(communes, {
  fid: (schema) => schema.trim().min(1),
  nom: (schema) => schema.trim().min(1)
})
  .omit({ geometry: true })
  .strict()

export const updateCommuneSchema = createUpdateSchema(communes).pick({ active: true }).strict()

export const createTerritoireSchema = createInsertSchema(territoires, {
  fid: (schema) => schema.trim().min(1)
})
  .omit({ geometry: true })
  .strict()
