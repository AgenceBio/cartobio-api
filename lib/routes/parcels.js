'use strict'

const MEGABYTE = 1048576

const parcelsOperatorSchema = {
  schema: {
    params: {
      numeroBio: { type: 'integer' }
    },

    body: {
      type: 'object',
      properties: {
        sender: {
          type: 'object',
          properties: {
            userName: {
              type: 'string'
            },
            ocId: {
              type: 'integer',
              minimum: 1
            },
            userEmail: {
              type: 'string',
              format: 'email'
            }
          },
          required: ['userName', 'ocId'],
          additionalProperties: false
        },
        uploads: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string'
              },
              disposition: {
                const: 'attachment'
              },
              size: {
                type: 'number',
                minimum: 0
              },
              type: {
                type: 'string'
              },
              filename: {
                type: 'string'
              }
            },
            required: ['content', 'type', 'filename'],
            additionalProperties: false
          }
        },
        text: {
          type: 'string'
        }
      },
      additionalProperties: false,
      required: ['sender', 'text', 'uploads']
    }
  },

  bodyLimit: 16 * MEGABYTE
}

module.exports = {
  parcelsOperatorSchema
}
