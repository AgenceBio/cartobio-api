'use strict'

const { Pool } = require('pg')

// default pg-node behaviour is parsing '2023-04-01' into a Date at
// local node process tz which is stupid
const pgTypes = require('pg').types
pgTypes.setTypeParser(
  pgTypes.builtins.DATE,
  (value) => value === null ? null : new Date(value).toISOString().split('T')[0]
)

const connectionString = require('./config.js').get('databaseUrl')

// the exported variable will be shared across all `require()` calls
module.exports = new Pool({ connectionString })
