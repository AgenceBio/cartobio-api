import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import config from '../src/config/env.js'
import { initTerritoires } from './init-territoires.js'

type Commune = { code: string; nom: string; geometry: unknown }

async function loadCommunes(db: NodePgDatabase): Promise<void> {
  const communes = (JSON.parse(await readFile('data/generated/communes.json', 'utf8')) as Commune[]).filter(
    ({ code, nom, geometry }) => code.length <= 5 && nom !== '' && geometry
  )

  for (let i = 0; i < communes.length; i += 1000) {
    await db.execute(
      sql`INSERT INTO cartobio.communes (fid, nom, active, geometry)
        SELECT c->>'code', c->>'nom', true, ST_Multi(ST_CollectionExtract(ST_SetSRID(ST_GeomFromGeoJSON(c->'geometry'), 4326), 3))
        FROM json_array_elements(${JSON.stringify(communes.slice(i, i + 1000))}::json) c`
    )
  }
}

export default async function (): Promise<void> {
  const testDatabaseName = config.get('testDatabaseName')
  const url = new URL(config.get('drizzleDatabaseUrl'))

  const db = drizzle({ connection: url.toString() })
  try {
    const { rows } = await db.execute<Record<string, unknown>>(
      sql`SELECT 1 FROM pg_database WHERE datname = ${testDatabaseName}`
    )
    if (!rows.length) await db.execute(sql`CREATE DATABASE ${sql.identifier(testDatabaseName)}`)
  } finally {
    await db.$client.end()
  }

  url.pathname = `/${testDatabaseName}`
  const testDb = drizzle({ connection: url.toString() })
  try {
    await testDb.execute('CREATE EXTENSION IF NOT EXISTS postgis')
    await testDb.execute('DROP SCHEMA IF EXISTS cartobio CASCADE')
    await testDb.execute('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await migrate(testDb, {
      migrationsFolder: 'database/drizzle',
      migrationsTable: 'journal'
    })
    await initTerritoires(testDb)
    await loadCommunes(testDb)
  } finally {
    await testDb.$client.end()
  }
}
