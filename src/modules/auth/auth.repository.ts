import { and, eq, or } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { sessions } from '../../database/schema/index.js'
import { createSessionSchema, rotateSessionSchema } from '../../database/validations/auth.js'

type Session = typeof sessions.$inferSelect

export async function insertSession(values: {
  userId: number
  tokenHash: string
  idToken: string | null
  expiresAt: Date
}): Promise<void> {
  await db.insert(sessions).values(createSessionSchema.parse(values))
}

export async function findSessionByTokenHash(tokenHash: string): Promise<Session | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(or(eq(sessions.tokenHash, tokenHash), eq(sessions.previousTokenHash, tokenHash)))
    .limit(1)
  return row
}

export async function rotateSession(
  id: string,
  currentTokenHash: string,
  values: { tokenHash: string; previousTokenHash: string; rotatedAt: Date; expiresAt: Date }
): Promise<boolean> {
  const { rowCount } = await db
    .update(sessions)
    .set(rotateSessionSchema.parse(values))
    .where(and(eq(sessions.id, id), eq(sessions.tokenHash, currentTokenHash)))
  return rowCount === 1
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id))
}
