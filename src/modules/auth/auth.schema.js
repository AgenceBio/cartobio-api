'use strict'

const { mergeSchemas, protectedWithToken, sandboxSchema } = require('../../../src/shared/routes/index.js')

module.exports = {
  mergeSchemas,
  protectedWithToken,
  sandboxSchema,
  internalSchema: { schema: { tags: ['cartobio'], security: [{ bearerAuth: [] }] } },
  hiddenSchema: { schema: { tags: ['X-HIDDEN'] } },
  externalExploitationSchema: {
    schema: {
      params: {
        type: 'object',
        required: ['numeroBio'],
        properties: {
          numeroBio: { type: 'string', pattern: '^[1-9]\\d*$' }
        }
      }
    }
  }
}
