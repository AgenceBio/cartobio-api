'use strict'

const app = require('./app.js')
const config = require('./config/env.js')
const db = require('../src/database/database.js')

async function start () {
  try {
    const { rows } = await db.query('SHOW server_version;')
    console.log(`Postgres connection established, v${rows[0].server_version}`)

    await app.ready()
    await app.swagger()

    const address = await app.listen({
      host: config.get('host'),
      port: config.get('port')
    })

    console.log(`Running env:${config.get('env')} on ${address}`)
  } catch (error) {
    app.log.error(error, 'Failed to start server')
    process.exitCode = 1
  }
}

if (require.main === module) {
  start()
}

module.exports = { start }
