import { createInsertSchema } from 'drizzle-orm/zod'
import { revokedTokens } from '../schema/auth.js'

export const createRevokedTokenSchema = createInsertSchema(revokedTokens, {
  tokenHash: (schema) => schema.trim().min(1)
})
  .pick({
    tokenHash: true,
    expiresAt: true
  })
  .strict()
