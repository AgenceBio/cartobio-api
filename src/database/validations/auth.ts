import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod'
import { sessions } from '../schema/auth.js'

export const createSessionSchema = createInsertSchema(sessions, {
  tokenHash: (schema) => schema.trim().min(1)
})
  .pick({
    userId: true,
    tokenHash: true,
    idToken: true,
    expiresAt: true
  })
  .strict()

export const rotateSessionSchema = createUpdateSchema(sessions, {
  tokenHash: (schema) => schema.trim().min(1),
  previousTokenHash: (schema) => schema.trim().min(1)
})
  .pick({
    tokenHash: true,
    previousTokenHash: true,
    rotatedAt: true,
    expiresAt: true
  })
  .required()
  .strict()
