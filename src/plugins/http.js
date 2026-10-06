'use strict'

const fp = require('fastify-plugin')
const cors = require('@fastify/cors')
const multipart = require('@fastify/multipart')
const formBody = require('@fastify/formbody')

async function httpPlugin (app) {
  await app.register(cors, {
    origin: true,
    methods:['*'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Accept-Encoding',
      'Authorization',
      'If-Unmodified-Since'
    ]
  })
  await app.register(multipart)
  await app.register(formBody)
}

module.exports = fp(httpPlugin, { name: 'http' })
