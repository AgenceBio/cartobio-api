import { LogController, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify'
import { pino, type Logger } from 'pino'
import config from './env.js'

class LoggerDev extends LogController {
  incomingRequest(): void {}

  requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply): void {
    const details: Record<string, unknown> = {}
    if (request.params && Object.keys(request.params).length > 0) details.params = request.params
    if (request.query && Object.keys(request.query).length > 0) details.query = request.query
    if (request.body !== undefined) details.body = request.body

    const message = `${request.method} ${request.url} → ${reply.statusCode} (${reply.elapsedTime.toFixed(0)}ms)`
    if (error) {
      request.log.error({ ...details, err: error }, message)
    } else {
      request.log.info(details, message)
    }
  }
}

function createLogger(env: string): Logger {
  if (env === 'test') return pino({ level: 'silent' })
  if (env !== 'dev') return pino()

  return pino({
    depthLimit: Number.MAX_SAFE_INTEGER,
    edgeLimit: Number.MAX_SAFE_INTEGER,
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,reqId',
        messageFormat: '{if reqId}[{reqId}] {end}{msg}'
      }
    }
  })
}

export const logger = createLogger(config.get('env'))

export function loggerOptions(): Pick<FastifyServerOptions, 'loggerInstance' | 'logController'> {
  if (config.get('env') !== 'dev') return { loggerInstance: logger }

  return { loggerInstance: logger, logController: new LoggerDev() }
}
