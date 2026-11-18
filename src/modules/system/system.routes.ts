import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { healthSchema, testSchema, versionSchema } from './system.schema.js'
import * as service from './system.service.js'

export default async function rootRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/api/v2/test', testSchema, async () => ({ message: 'OK' }))

  app.get('/api/version', versionSchema, async () => ({ version: service.getVersion() }))

  app.get('/api/v3/health', healthSchema, async (request, reply) => {
    try {
      const health = await service.getHealth()
      return reply.status(200).send(health)
    } catch (error) {
      request.log.error(error)
      return reply.status(503).send(service.getUnavailableHealth())
    }
  })
}
