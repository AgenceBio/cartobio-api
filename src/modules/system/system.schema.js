'use strict'

const { mergeSchemas, protectedWithToken, sandboxSchema } = require('../../../src/shared/routes/index.js')

module.exports = {
  testSchema: mergeSchemas(sandboxSchema, protectedWithToken({ oc: true, cartobio: true })),
  versionSchema: sandboxSchema
}
