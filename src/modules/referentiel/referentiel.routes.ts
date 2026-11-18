import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { departementsSchema } from './referentiel.schema.js'
import * as service from './referentiel.service.js'

export default async function referentielRoutes (fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get(
    '/api/v2/departements',
    departementsSchema,
    async (_request, reply) => {
      const departements = await service.getDepartement()
      return reply.code(200).send(departements)
    }
  )
}
