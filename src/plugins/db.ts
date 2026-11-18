import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import pool from '../database/database.js'

async function databasePlugin (app: FastifyInstance): Promise<void> {
  app.addHook('onClose', async (): Promise<void> => {
    await pool.end()
  })
}

export default fp(databasePlugin, { name: 'database' })
