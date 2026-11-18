#!/usr/bin/env node

import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from '../src/database/database.js'

const envPath = resolve(process.cwd(), '.env')
console.log(`.env : ${existsSync(envPath) ? envPath : 'introuvable'}`)

const targetUrl = process.env.TARGET_DATABASE_URL
if (!targetUrl) throw new Error('TARGET_DATABASE_URL est obligatoire')

const { hostname, port, pathname, username } = new URL(targetUrl)
console.log(`Cible : ${username}@${hostname}:${port}${pathname}`)

try {
  await db.execute(sql`DROP SCHEMA IF EXISTS cartobio CASCADE`)
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)

  const { rowCount } = await db.execute(
    sql`SELECT 1 FROM information_schema.schemata WHERE schema_name IN ('cartobio', 'drizzle')`
  )
  if (rowCount) throw new Error('Les schémas cartobio ou drizzle existent toujours après la suppression')

  console.log('Schémas cartobio et drizzle supprimés')

  await migrate(db, { migrationsFolder: 'database/drizzle', migrationsTable: 'journal' })

  console.log('Migrations drizzle appliquées')
} finally {
  await db.$client.end()
}
