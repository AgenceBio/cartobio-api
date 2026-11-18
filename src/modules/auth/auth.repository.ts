import { eq, sql } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { departements, regions, revokedTokens } from '../../database/schema/index.js'
import { createRevokedTokenSchema } from '../../database/validations/auth.js'
import type { DepartementRow } from './auth.types.js'

async function findDepartements(): Promise<DepartementRow[]> {
  return db
    .select({
      nomRegion: sql<string>`CASE WHEN LENGTH(${departements.fid}) = 3 THEN 'DOM-TOM' ELSE ${regions.nom} END`,
      code: departements.fid,
      nom: departements.nom
    })
    .from(departements)
    .leftJoin(regions, eq(departements.codeRegion, regions.code))
}

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

export { findDepartements, insertRevokedToken, hasRevokedToken }
