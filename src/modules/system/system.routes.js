'use strict'

const { testSchema, versionSchema } = require('./system.schema.js')
const service = require('./system.service.js')

module.exports = async function rootRoutes (app) {
  app.get('/api/v2/test', testSchema, async () => ({ message: 'OK' }))

  app.get('/api/version', versionSchema, async () => ({ version: service.getVersion() }))

  app.get('/api/v3/health', async (request, reply) => {
    try {
      const health = await service.getHealth()
      return reply.status(200).send(health)
    } catch (error) {
      request.log.error(error)
      return reply.status(503).send(service.getUnavailableHealth())
    }
  })
}
