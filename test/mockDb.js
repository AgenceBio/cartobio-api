const { expect } = require('@jest/globals')

const isISO8601 = require('validator/lib/isISO8601.js')

expect.extend({
  stringMatchingISODate (actual) {
    const result = isISO8601(actual, { strict: true, strictSeparator: true })

    if (result) {
      return {
        pass: true,
        message () {
          return ''
        }
      }
    } else {
      return {
        pass: false,
        message () {
          return `expected ${this.utils.printReceived(actual)} to be a valid ISO 8601 date with timestamp`
        }
      }
    }
  },

  toBeAFeatureId (actual) {
    const val = typeof actual === 'number' ? actual : parseInt(actual, 10)

    if (!Number.isNaN(val) && val > 0) {
      return {
        pass: true,
        message () {
          return ''
        }
      }
    } else {
      return {
        pass: false,
        message () {
          return `expected ${this.utils.printReceived(actual)} to be a valid feature id`
        }
      }
    }
  }
})

jest.mock('../lib/db.js', () => {
  const { Client } = require('pg')
  const pgTypes = require('pg').types
  pgTypes.setTypeParser(
    pgTypes.builtins.DATE,
    (value) => value === null ? null : new Date(value).toISOString().split('T')[0]
  )
  const connectionString = require('../lib/config.js').get('databaseUrl')
  const testDatabaseName = require('../lib/config.js').get('testDatabaseName')

  const url = new URL(connectionString)

  // every app query will
  // go through this client
  const client = new Client({
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: url.port,
    database: testDatabaseName
  })

  // this mock will be return by the pool.connect()
  const _clientQuery = jest.fn(async (...args) => {
    if (args[0].startsWith('BEGIN')) {
      return client.query.bind(client)('SAVEPOINT test')
    }

    if (args[0].startsWith('ROLLBACK')) {
      return client.query.bind(client)('ROLLBACK TO SAVEPOINT test')
    }

    if (args[0].startsWith('COMMIT')) {
      return client.query.bind(client)('RELEASE SAVEPOINT test')
    }

    return client.query.bind(client)(...args)
  })

  const _clientRelease = jest.fn()

  return {
    // return a mock Pool object which
    // pass all calls to our testing client
    query: jest.fn(client.query.bind(client)),
    connect: jest.fn(async () => ({
      query: _clientQuery,
      release: _clientRelease
    })),
    // to be used to manage the test client from inside the tests
    _connect: client.connect.bind(client),
    _end: client.end.bind(client),
    _clientQuery: _clientQuery, // so we can test calls
    _clientRelease: _clientRelease // so we can test calls
  }
})

beforeAll(async () => {
  const client = require('../lib/db.js')
  await client._connect()
})

beforeEach(async () => {
  const client = require('../lib/db.js')
  await client.query('BEGIN')
  client.query.mockClear()
})

afterEach(async () => {
  const client = require('../lib/db.js')
  await client.query('ROLLBACK')
})

afterAll(async () => {
  const client = require('../lib/db.js')
  await client._end()
})
