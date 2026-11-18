import { sql } from 'drizzle-orm'
import { db } from '../../database/database.js'

async function isHealthy(): Promise<void> {
  await db.execute(sql`SELECT 1`)
}

export { isHealthy as checkHealth }
