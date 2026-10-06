'use strict'

const repository = require('./system.repository.js')
const config = require('../../../src/config/env.js')

async function getHealth () {
  await repository.checkHealth()
  return { status: 'ok', db: 'ok', uptime: process.uptime(), timestamp: Date.now() }
}

function getUnavailableHealth () {
  return { status: 'ok', db: 'unreachable', uptime: process.uptime(), timestamp: Date.now() }
}

module.exports = {
  getVersion: () => config.get('version'),
  getHealth,
  getUnavailableHealth
}
