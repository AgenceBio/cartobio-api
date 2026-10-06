'use strict'

const { mergeSchemas, protectedWithToken } = require('../../../src/shared/routes/index.js')

const protectedRouteSchema = () => mergeSchemas(protectedWithToken())

module.exports = {
  rpgSchema: protectedRouteSchema(),
  borderCutSchema: protectedRouteSchema(),
  geometryEqualsSchema: protectedRouteSchema(),
  addGeometrySchema: protectedRouteSchema()
}
