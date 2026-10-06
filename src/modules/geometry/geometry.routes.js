'use strict'

const { rpgSchema, borderCutSchema, geometryEqualsSchema, addGeometrySchema } = require('./geometry.schema.js')
const service = require('./geometry.service.js')

module.exports = async function geometryRoutes (app) {
  app.post('/api/v2/geometry/rpg', rpgSchema, async (request, reply) => {
    const { extent, surface, codeCulture } = request.body
    const data = await service.getRpg(extent, surface, codeCulture)
    return data ? reply.code(200).send(data) : reply.code(404).send()
  })

  app.post('/api/v3/geometry/border-cut', borderCutSchema, async (request, reply) => {
    const { geometry, distance, allBorder, isInverted, startBorderPoint, endBorderPoint } = request.body
    const result = service.calculateParcelBorder(JSON.stringify(geometry), distance, allBorder, isInverted, startBorderPoint, endBorderPoint)
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
