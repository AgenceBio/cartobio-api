'use strict'

const { mergeSchemas, protectedWithToken } = require('../../../src/shared/routes/index.js')

module.exports = {
  exportPdfSchema: mergeSchemas(protectedWithToken()),
  exportParcellaireSchema: mergeSchemas(protectedWithToken({ oc: true, cartobio: true }))
}
