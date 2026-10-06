'use strict'

const tryLoginSchema = {
  schema: {
    body: {
      type: 'object',
      properties: {
        q: {
          type: 'string'
        }
      },
      required: ['q'],
      additionalProperties: false
    }
  }
}

module.exports = {
  tryLoginSchema
}
