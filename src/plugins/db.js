'use strict'

const fp = require('fastify-plugin')
const db = require('../../src/database/database.js')

async function dbPlugin (app) {
  app.decorate('db', db)
}

module.exports = fp(dbPlugin, { name: 'database' })
