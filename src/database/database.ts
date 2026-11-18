import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import config from '../config/env.js'

const { Pool, types: pgTypes } = pg

// default pg-node behaviour is parsing '2023-04-01' into a Date at
// local node process tz which is stupid
pgTypes.setTypeParser(
  pgTypes.builtins.DATE,
  (value) => value === null ? null : new Date(value).toISOString().split('T')[0]
)

// the exported variable will be shared across all imports
const pool = new Pool({ connectionString: config.get('databaseUrl') })

export const db = drizzle({ client: new Pool({ connectionString: config.get('drizzleDatabaseUrl') }) })

export default pool
