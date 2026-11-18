import validator from 'validator'
import type { NodePgClient, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { db } from '../src/database/database.js'
import type { Client, QueryConfig } from 'pg'

const rawDb = (db.$client as NodePgClient & { _raw: NodePgDatabase & { $client: Client } })._raw

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

vi.mock('../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/modules/auth/auth.service.js')>()),
  getHistoryUser: vi.fn(async (userId: string | number, userRole: string | null) => ({
    id: Number(userId),
    nom: '',
    prenom: '',
    groups: [],
    mainGroup: { nom: userRole }
  }))
}))

vi.mock('../src/database/database.js', async () => {
  const { default: pg } = await import('pg')
  const { default: config } = await import('../src/config/env.js')
  const pgTypes = pg.types
  pgTypes.setTypeParser(pgTypes.builtins.DATE, (value) =>
    value === null ? null : new Date(value).toISOString().split('T')[0]
  )
  const testDatabaseName = config.get('testDatabaseName')

  const { drizzle } = await import('drizzle-orm/node-postgres')
  const drizzleUrl = new URL(config.get('drizzleDatabaseUrl'))
  drizzleUrl.pathname = `/${testDatabaseName}`
  const drizzleClient = new pg.Client({ connectionString: drizzleUrl.toString() })

  function transactionStatement(text: string): string | undefined {
    if (/^begin\b/i.test(text)) return 'SAVEPOINT drizzle_test'
    if (/^commit$/i.test(text)) return 'RELEASE SAVEPOINT drizzle_test'
    if (/^rollback$/i.test(text)) return 'ROLLBACK TO SAVEPOINT drizzle_test'
  }

  const { firstRow } =
    await vi.importActual<typeof import('../src/database/database.js')>('../src/database/database.js')

  return {
    firstRow,
    db: drizzle({
      client: {
        query: (queryConfig: QueryConfig, values?: unknown[]) => {
          const statement = transactionStatement(queryConfig.text.trim())
          return statement ? drizzleClient.query(statement) : drizzleClient.query(queryConfig, values)
        },
        end: vi.fn(async (): Promise<void> => {}),
        _raw: drizzle({ client: drizzleClient })
      } as unknown as Client
    })
  }
})

beforeAll(async () => {
  await rawDb.$client.connect()
})

beforeEach(async () => {
  await rawDb.execute('BEGIN')
})

afterEach(async () => {
  await rawDb.execute('ROLLBACK')
})

afterAll(async () => {
  await rawDb.$client.end()
})
