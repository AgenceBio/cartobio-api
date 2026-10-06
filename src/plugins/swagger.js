'use strict'

const fp = require('fastify-plugin')
const swagger = require('@fastify/swagger')
const swaggerUi = require('@fastify/swagger-ui')
const { swaggerConfig } = require('../../src/shared/routes/index.js')

async function documentationPlugin (app) {
  await app.register(swagger, swaggerConfig)
  await app.register(swaggerUi, { routePrefix: '/api/documentation' })
}

module.exports = fp(documentationPlugin, { name: 'documentation' })
