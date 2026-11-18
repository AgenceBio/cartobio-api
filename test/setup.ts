import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import config from '../src/config/env.js'
import { initTerritoires } from './init-territoires.js'

const { Client } = pg

type Commune = { code: string; nom: string; geometry: unknown }

async function loadCommunes(client: pg.Client): Promise<void> {
  const communes = (JSON.parse(await readFile('data/generated/communes.json', 'utf8')) as Commune[]).filter(
    ({ code, nom, geometry }) => code.length <= 5 && nom !== '' && geometry
  )

  for (let i = 0; i < communes.length; i += 1000) {
    await client.query(
      `INSERT INTO cartobio.communes (fid, nom, active, geometry)
        SELECT c->>'code', c->>'nom', true, ST_Multi(ST_CollectionExtract(ST_SetSRID(ST_GeomFromGeoJSON(c->'geometry'), 4326), 3))
        FROM json_array_elements($1::json) c`,
      [JSON.stringify(communes.slice(i, i + 1000))]
    )
  }
}

export default async function (): Promise<void> {
  const testDatabaseName = config.get('testDatabaseName')
  const url = new URL(config.get('drizzleDatabaseUrl'))

  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDatabaseName])
  if (!rows.length) await client.query(`CREATE DATABASE ${testDatabaseName}`)
  await client.end()

  url.pathname = `/${testDatabaseName}`
  const testClient = new Client({ connectionString: url.toString() })
  await testClient.connect()
  try {
    await testClient.query('CREATE EXTENSION IF NOT EXISTS postgis')
    await testClient.query('DROP SCHEMA IF EXISTS cartobio CASCADE')
    await testClient.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await migrate(drizzle({ client: testClient }), { migrationsFolder: 'database/drizzle', migrationsTable: 'journal' })
    await initTerritoires(testClient)
    await loadCommunes(testClient)
  } finally {
    await testClient.end()
  }
}
