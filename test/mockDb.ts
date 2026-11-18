import validator from 'validator'
import pool, { db } from '../src/database/database.js'
import type { Mock } from 'vitest'
import type { Client, QueryConfig } from 'pg'

const client = pool as unknown as {
  query: Mock
  _connect: () => Promise<void>
  _end: () => Promise<void>
}

const drizzleClient = db.$client as unknown as {
  _query: (text: string) => Promise<unknown>
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

  const { drizzle } = await import('drizzle-orm/node-postgres')
  const drizzleUrl = new URL(config.get('drizzleDatabaseUrl'))
  drizzleUrl.pathname = `/${testDatabaseName}`
  const drizzleClient = new pg.Client({ connectionString: drizzleUrl.toString() })

  function transactionStatement (text: string): string | undefined {
    if (/^begin\b/i.test(text)) return 'SAVEPOINT drizzle_test'
    if (/^commit$/i.test(text)) return 'RELEASE SAVEPOINT drizzle_test'
    if (/^rollback$/i.test(text)) return 'ROLLBACK TO SAVEPOINT drizzle_test'
  }

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
    db: drizzle({
      client: {
        query: (queryConfig: QueryConfig, values?: unknown[]) => {
          const statement = transactionStatement(queryConfig.text.trim())
          return statement ? drizzleClient.query(statement) : drizzleClient.query(queryConfig, values)
        },
        end: vi.fn(async (): Promise<void> => {}),
        _query: (text: string) => drizzleClient.query(text),
        _connect: drizzleClient.connect.bind(drizzleClient),
        _end: drizzleClient.end.bind(drizzleClient)
      } as unknown as Client
    })
  }
})

beforeAll(async () => {
  await Promise.all([client._connect(), drizzleClient._connect()])
})

beforeEach(async () => {
  await drizzleClient._query('BEGIN')
  await client.query('BEGIN')
  client.query.mockClear()
})

afterEach(async () => {
  await client.query('ROLLBACK')
  await drizzleClient._query('ROLLBACK')
})

afterAll(async () => {
  await Promise.all([client._end(), drizzleClient._end()])
})
