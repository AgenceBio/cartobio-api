#!/usr/bin/env node

import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const envPath = resolve(process.cwd(), '.env')
console.log(`.env : ${existsSync(envPath) ? envPath : 'introuvable'}`)

const targetUrl = process.env.TARGET_DATABASE_URL
if (!targetUrl) throw new Error('TARGET_DATABASE_URL est obligatoire')

const { hostname, port, pathname, username } = new URL(targetUrl)
console.log(`Cible : ${username}@${hostname}:${port}${pathname}`)

const client = new pg.Client({ connectionString: targetUrl })
await client.connect()
try {
  await client.query('DROP SCHEMA IF EXISTS cartobio CASCADE')
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE')

  const { rowCount } = await client.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name IN ('cartobio', 'drizzle')"
  )
  if (rowCount) throw new Error('Les schémas cartobio ou drizzle existent toujours après la suppression')

  console.log('Schémas cartobio et drizzle supprimés')
} finally {
  await client.end()
}
