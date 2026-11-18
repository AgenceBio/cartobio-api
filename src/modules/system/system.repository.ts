import { sql } from 'drizzle-orm'
import { db } from '../../database/database.js'

const isHealthy = () => db.execute(sql`SELECT 1`)

export { isHealthy as checkHealth }
