'use strict'

const pool = require('../../../src/database/database.js')
const isHealthy = () => pool.query('SELECT 1')

module.exports = {
  checkHealth: isHealthy
}
