'use strict'

const { mergeSchemas, protectedWithToken, operatorFromNumeroBio } = require('../../../src/shared/routes/index.js')

module.exports = {
  mergeSchemas,
  protectedWithToken,
  operatorFromNumeroBio,
  operatorsSchema: { schema: { querystring: { type: 'object', properties: { search: { type: 'string' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } },
  certificationBodySearchSchema: { schema: { body: { type: 'object', required: ['input'], properties: { input: { type: 'string' }, page: { type: 'integer', default: 1 }, limit: { type: 'integer', default: 7 }, filter: { type: 'object' } } } } },
  autocompleteSchema: { schema: { querystring: { type: 'object', properties: { search: { type: 'string' } } } } },
  dashboardSummarySchema: { schema: { body: { type: 'object', required: ['departements', 'anneeReferenceControle'], properties: { departements: { type: 'array', items: { type: 'string' } }, anneeReferenceControle: { type: 'integer' } } } } }
}
