import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { borderCutSchema, geometryEqualsSchema, addGeometrySchema } from './geometry.schema.js'
import * as service from './geometry.service.js'

export default async function geometryRoutes (fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/api/v3/geometry/border-cut', borderCutSchema, async (request, reply) => {
    const { geometry, distance, allBorder, isInverted, startBorderPoint, endBorderPoint } = request.body
    const result = await service.calculateParcelBorder(geometry, distance, allBorder, isInverted, startBorderPoint, endBorderPoint)
    return result || reply.code(400).send()
  })

  app.post('/api/v2/geometry/geometryEquals', geometryEqualsSchema, async (request, reply) => {
    const data = await service.getGeometryEquals(request.body.payload)
    return reply.code(200).send(data)
  })

  app.post('/api/v2/geometry/:recordId/add', addGeometrySchema, async (request, reply) => {
    const feature = request.body.payload
    const record = await service.verifyGeometry(feature.geometry, request.params.recordId, feature.properties?.id ?? '')
    return reply.code(200).send(record)
  })
}
