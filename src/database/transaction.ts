import type { PoolClient } from 'pg'
import pool from './database.js'

let savepointId = 0

export async function withTransaction<T> (
  callback: (client: PoolClient) => Promise<T>,
  client?: PoolClient
): Promise<T> {
  if (client) {
    const savepoint = `sp_${++savepointId}`
    await client.query(`SAVEPOINT ${savepoint}`)
    try {
      const result = await callback(client)
      await client.query(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      throw error
    }
  }

  const ownClient = await pool.connect()
  try {
    await ownClient.query('BEGIN')
    const result = await callback(ownClient)
    await ownClient.query('COMMIT')
    return result
  } catch (error) {
    await ownClient.query('ROLLBACK')
    throw error
  } finally {
    ownClient.release()
  }
}
