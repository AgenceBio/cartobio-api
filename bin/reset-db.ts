#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import config from '../src/config/env.js'
import { db } from '../src/database/database.js'

if (config.get('env') === 'production') throw new Error('db:reset est interdit en production')

const envPath = resolve(process.cwd(), '.env')
console.log(`.env : ${existsSync(envPath) ? envPath : 'introuvable'}`)

const { hostname, port, pathname, username } = new URL(config.get('drizzleDatabaseUrl'))
console.log(`Cible : ${username}@${hostname}:${port}${pathname}`)

try {
  await db.execute(sql`DROP SCHEMA IF EXISTS cartobio CASCADE`)
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)

  const { rowCount } = await db.execute<Record<string, unknown>>(
    sql`SELECT 1 FROM information_schema.schemata WHERE schema_name IN ('cartobio', 'drizzle')`
  )
  if (rowCount) throw new Error('Les schémas cartobio ou drizzle existent toujours après la suppression')

  console.log('Schémas cartobio et drizzle supprimés')

  await migrate(db, { migrationsFolder: 'database/drizzle', migrationsTable: 'journal' })

  console.log('Migrations drizzle appliquées')
} finally {
  await db.$client.end()
}
