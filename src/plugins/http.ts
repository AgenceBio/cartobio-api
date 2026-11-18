import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import formBody from '@fastify/formbody'

async function httpPlugin(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
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

export default fp(httpPlugin, { name: 'http' })
