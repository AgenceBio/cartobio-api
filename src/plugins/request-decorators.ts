import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

async function requestDecorators (app: FastifyInstance): Promise<void> {
  app.decorateRequest('user', null)
  app.decorateRequest('organismeCertificateur', null)
  app.decorateRequest('operator', null)
  app.decorateRequest('record', null)
  app.decorateRequest('originalPayload', undefined)
}

export default fp(requestDecorators, { name: 'request-decorators' })
