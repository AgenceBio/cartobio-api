import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import formBody from '@fastify/formbody'
import config from '../config/env.js'

async function httpPlugin(app: FastifyInstance): Promise<void> {
  const corsOrigins = config.get('corsOrigins')
  await app.register(cors, {
    origin:
      config.get('env') === 'dev'
        ? true
        : corsOrigins.length > 0
          ? corsOrigins
          : [new URL(config.get('frontendUrl')).origin],
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
