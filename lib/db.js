'use strict'

const { Pool } = require('pg')

const connectionString = require('./config.js').get('databaseUrl')

// the exported variable will be shared across all `require()` calls
module.exports = new Pool({ connectionString })
