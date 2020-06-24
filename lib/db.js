'use strict'

const { Pool } = require('pg')

const { DATABASE_URL: connectionString } = require('./app.js').env()

// the exported variable will be shared across all `require()` calls
module.exports = new Pool({ connectionString })
