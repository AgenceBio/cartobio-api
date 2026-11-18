import validator from 'validator'
import db from '../src/database/database.js'
import type { Mock } from 'vitest'

const client = db as unknown as {
  query: Mock
  _connect: () => Promise<void>
  _end: () => Promise<void>
}

expect.extend({
  stringMatchingISODate(actual) {
    const { utils } = this
    const result = validator.isISO8601(actual, { strict: true, strictSeparator: true })

    if (result) {
      return {
        pass: true,
        message() {
          return ''
        }
      }
    } else {
      return {
        pass: false,
        message() {
          return `expected ${utils.printReceived(actual)} to be a valid ISO 8601 date with timestamp`
        }
      }
    }
  },

  toBeAFeatureId(actual) {
    const { utils } = this
    const val = typeof actual === 'number' ? actual : parseInt(actual, 10)

    if (!Number.isNaN(val) && val > 0) {
      return {
        pass: true,
        message() {
          return ''
        }
      }
    } else {
      return {
        pass: false,
        message() {
          return `expected ${utils.printReceived(actual)} to be a valid feature id`
        }
      }
    }
  }
})

vi.mock('got')

vi.mock('../src/database/database.js', async () => {
  const { default: pg } = await import('pg')
  const { default: config } = await import('../src/config/env.js')
  const pgTypes = pg.types
  pgTypes.setTypeParser(pgTypes.builtins.DATE, (value) =>
    value === null ? null : new Date(value).toISOString().split('T')[0]
  )
  const connectionString = config.get('databaseUrl')
  const testDatabaseName = config.get('testDatabaseName')

  const url = new URL(connectionString)

  // every app query will
  // go through this client
  const client = new pg.Client({
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    database: testDatabaseName
  })

  // this mock will be return by the pool.connect()
  const _clientQuery = vi.fn((...args: Parameters<typeof client.query>) => {
    if (typeof args[0] === 'string' && args[0].startsWith('BEGIN')) {
      return client.query.bind(client)('SAVEPOINT test')
    }

    if (typeof args[0] === 'string' && args[0].startsWith('ROLLBACK')) {
      return client.query.bind(client)('ROLLBACK TO SAVEPOINT test')
    }

    if (typeof args[0] === 'string' && args[0].startsWith('COMMIT')) {
      return client.query.bind(client)('RELEASE SAVEPOINT test')
    }

    return (client.query as (...a: unknown[]) => unknown).bind(client)(...args)
  })

  const _clientRelease = vi.fn()

  return {
    default: {
      query: vi.fn(client.query.bind(client)),
      connect: vi.fn(async () => ({
        query: _clientQuery,
        release: _clientRelease
      })),
      end: vi.fn(async (): Promise<void> => {}),
      _connect: client.connect.bind(client),
      _end: client.end.bind(client),
      _clientQuery: _clientQuery,
      _clientRelease: _clientRelease
    },
    db: {
      $client: {
        end: vi.fn(async (): Promise<void> => {})
      }
    }
  }
})

beforeAll(async () => {
  await client._connect()
})

beforeEach(async () => {
  await client.query('BEGIN')
  client.query.mockClear()
})

afterEach(async () => {
  await client.query('ROLLBACK')
})

afterAll(async () => {
  await client._end()
})
