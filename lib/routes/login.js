'use strict'

const loginSchema = {
  schema: {
    body: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          format: 'email'
        },
        password: {
          type: 'string'
        }
      },
      required: ['email', 'password'],
      additionalProperties: false
    }
  }
}

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
  loginSchema,
  tryLoginSchema
}
