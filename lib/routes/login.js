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

module.exports = {
  loginSchema
}
