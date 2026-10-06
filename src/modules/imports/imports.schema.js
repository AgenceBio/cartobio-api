'use strict'

const { mergeSchemas, protectedWithToken, operatorFromNumeroBio } = require('../../../src/shared/routes/index.js')

module.exports = {
  mergeSchemas,
  protectedWithToken,
  operatorFromNumeroBio,
  routeWithPacage: { schema: { params: { numeroPacage: { type: 'string', pattern: '^\\d{9}$' } } } },
  geofoliaImportSchema: { schema: { querystring: { type: 'object', properties: { year: { type: 'number', minimum: new Date().getUTCFullYear() - 3, maximum: new Date().getUTCFullYear(), default: new Date().getUTCFullYear() } } } } }
}
