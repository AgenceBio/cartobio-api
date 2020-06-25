'use strict'

const operatorSchema = {
  params: {
    numeroBio: { type: 'integer' }
  },
  body: {
    type: 'object',
    properties: {
      numeroPacage: {
        type: 'string',
        pattern: '^([0-9]{9}|)$',
        nullable: true
      }
    },
    additionalProperties: false
  }
}

module.exports = {
  operatorSchema
}
