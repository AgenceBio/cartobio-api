import { eq } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { revokedTokens } from '../../database/schema/index.js'
import { createRevokedTokenSchema } from '../../database/validations/auth.js'

async function insertRevokedToken(tokenHash: string, expiration: number): Promise<void> {
  await db
    .insert(revokedTokens)
    .values(createRevokedTokenSchema.parse({ tokenHash, expiresAt: new Date(expiration * 1000) }))
    .onConflictDoNothing({ target: revokedTokens.tokenHash })
}

async function hasRevokedToken(tokenHash: string): Promise<boolean> {
  const [row] = await db
    .select({ tokenHash: revokedTokens.tokenHash })
    .from(revokedTokens)
    .where(eq(revokedTokens.tokenHash, tokenHash))
    .limit(1)
  return row !== undefined
}

export { insertRevokedToken, hasRevokedToken }
