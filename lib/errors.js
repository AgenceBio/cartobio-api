
class NotFoundApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 404
    this.name = 'NotFoundApiError'

    Error.captureStackTrace(this, this.constructor)
  }
}

class UnauthorizedApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 401
    this.name = 'UnauthorizedApiError'

    Error.captureStackTrace(this, this.constructor)
  }
}

class InvalidRequestApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 400
    this.name = 'InvalidRequestApiError'

    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Handle errors in fastify
 * @param {{ sentryClient: import('@sentry/node').NodeClient }} params
 * @returns {function}
 */
function FastifyErrorHandler ({ sentryClient }) {
  /**
   * @param {Error & {validation: any?, statusCode: Number?}} error
   * @param {import("fastify").FastifyRequest} request
   * @param {import("fastify").FastifyReply} reply
   */
  return function errorHandler (error, request, reply) {
    // These are user-led errors, we do not need to log them.
    if (error.validation) {
      return reply.send(new InvalidRequestApiError(error.message, error))
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: error.message
      })
    }

    if (process.env.NODE_ENV === 'test') {
      // Just throw error without returning anything in test (cleaner log)
      throw error
    } else if (process.env.NODE_ENV !== 'production') {
      // Stack traces on console in development
      console.error(error.stack)
    } else {
      // And to sentry in production
      sentryClient.captureException(error)
    }

    return reply.code(500).send({
      error: 'Erreur serveur. Nous avons été informés et résoudrons ceci au plus vite.'
    })
  }
}

module.exports = {
  FastifyErrorHandler,
  InvalidRequestApiError,
  NotFoundApiError,
  UnauthorizedApiError
}
