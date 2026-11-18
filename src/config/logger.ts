import { LogController, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify'
import { pino, type Logger } from 'pino'
import config from './env.js'

const MAX_ARRAY_ITEMS = 5

function abbreviate (value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, v: unknown) => {
    if (!Array.isArray(v)) return v
    if (key === 'coordinates') return `<${v.flat(Infinity).length / 2} points>`
    return v.length > MAX_ARRAY_ITEMS ? [...v.slice(0, MAX_ARRAY_ITEMS), `… +${v.length - MAX_ARRAY_ITEMS}`] : v
  }))
}

class LoggerDev extends LogController {
  incomingRequest (): void {}

  requestCompleted (error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply): void {
    const details: Record<string, unknown> = {}
    if (request.query && Object.keys(request.query).length > 0) details.query = request.query
    if (request.body !== undefined) details.body = abbreviate(request.body)

    const message = `${request.method} ${request.url} → ${reply.statusCode} (${reply.elapsedTime.toFixed(0)}ms)`
    if (error) {
      request.log.error({ ...details, err: error }, message)
    } else {
      request.log.info(details, message)
    }
  }
}

function createLogger (env: string): Logger {
  if (env === 'test') return pino({ level: 'silent' })
  if (env !== 'dev') return pino()

  return pino({
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

export function loggerOptions (): Pick<FastifyServerOptions, 'loggerInstance' | 'logController'> {
  if (config.get('env') !== 'dev') return { loggerInstance: logger }

  return { loggerInstance: logger, logController: new LoggerDev() }
}
