import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import config from '../src/config/env.js'
import DBMigrate from 'db-migrate'
import { initTerritoires } from './init-territoires.js'

const { Client } = pg

async function setupDrizzleTestDatabase (testDatabaseName: string): Promise<void> {
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
  } finally {
    await testClient.end()
  }
}

export default async function () {
  await setupDrizzleTestDatabase(config.get('testDatabaseName'))

  const connectionString = config.get('databaseUrl')
  const testDatabaseName = config.get('testDatabaseName')

  const client = new Client({ connectionString })
  await client.connect()
  // Check if the test database already exists
  const { rows } = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${testDatabaseName}'`)
  if (!rows.length) await client.query(`CREATE DATABASE ${testDatabaseName}`)
  await client.end()

  const url = new URL(connectionString)
  const testClient = new Client({
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    database: testDatabaseName
  })
  await testClient.connect()
  await testClient.query('CREATE EXTENSION IF NOT EXISTS postgis')
  await testClient.query('CREATE EXTENSION IF NOT EXISTS postgis_topology')

  process.env.DATABASE_URL = '' // otherwise db-migrate will use the production database
  const dbmigrate = DBMigrate.getInstance(true, {
    config: {
      test: {
        driver: 'pg',
        host: url.hostname,
        port: url.port,
        user: url.username,
        password: url.password,
        database: testDatabaseName
      }
    },
    cmdOptions: {
      'migrations-dir': 'database/old_migrations'
    },
    env: 'test'
  })
  dbmigrate.silence(true)
  await dbmigrate.up()

  await testClient.query('TRUNCATE TABLE cartobio_operators CASCADE')

  await initTerritoires(testClient)

  await testClient.end()

  process.env.DATABASE_URL = connectionString
}
