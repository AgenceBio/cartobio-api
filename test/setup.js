const { Client } = require('pg')
const DBMigrate = require('db-migrate')

module.exports = async function () {
  const connectionString = require('../lib/config.js').get('databaseUrl')
  const testDatabaseName = require('../lib/config.js').get('testDatabaseName')

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
    port: url.port,
    database: testDatabaseName
  })
  await testClient.connect()
  await testClient.query('CREATE EXTENSION IF NOT EXISTS postgis')
  await testClient.query('CREATE EXTENSION IF NOT EXISTS postgis_topology')

  const process = require('process')
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
    env: 'test'
  })
  dbmigrate.silence(true)
  await dbmigrate.up()

  await testClient.query('TRUNCATE TABLE cartobio_operators CASCADE')
  await testClient.end()

  process.env.DATABASE_URL = connectionString
}
