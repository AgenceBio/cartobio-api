import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod'
import { z } from 'zod'
import {
  attestationsProduction,
  operateursConsultes,
  operateursEpingles,
  parcellesControles
} from '../schema/activites.js'
import { productionAttestationStatus } from '../schema/enums.js'

export const productionAttestationStatusEnumSchema = z.enum(productionAttestationStatus.enumValues)

export const createOperateurEpingleSchema = createInsertSchema(operateursEpingles, {
  numeroBio: (schema) => schema.int().positive(),
  userId: (schema) => schema.trim().min(1)
})
  .pick({
    numeroBio: true,
    userId: true
  })
  .strict()

export const createOperateurConsulteSchema = createInsertSchema(operateursConsultes, {
  numeroBio: (schema) => schema.int().positive(),
  userId: (schema) => schema.trim().min(1)
})
  .pick({
    numeroBio: true,
    userId: true
  })
  .strict()

export const createAttestationProductionSchema = createInsertSchema(attestationsProduction)
  .pick({
    recordId: true,
    type: true,
    status: true,
    path: true
  })
  .strict()

export const updateAttestationProductionSchema = createUpdateSchema(attestationsProduction)
  .pick({
    status: true
  })
  .strict()

export const createParcelleControleSchema = createInsertSchema(parcellesControles, {
  parcelleId: (schema) => schema.trim().min(1),
  userId: (schema) => schema.trim().min(1)
})
  .pick({
    recordId: true,
    parcelleId: true,
    userId: true
  })
  .strict()
