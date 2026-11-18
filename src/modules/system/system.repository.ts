import { sql } from 'drizzle-orm'
import { db } from '../../database/database.js'

export async function checkHealth(): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
