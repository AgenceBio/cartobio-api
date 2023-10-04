
class NotFoundApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 404

    Error.captureStackTrace(this, this.constructor)
  }
}

class UnauthorizedApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 401

    Error.captureStackTrace(this, this.constructor)
  }
}

class InvalidRequestApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 400

    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Handle errors in fastify
 * @param {{ sentryClient: import('@sentry/node').NodeClient }}
 * @returns {function}
 */
function FastifyErrorHandler ({ sentryClient }) {
  /**
   * @param {Error} error
   * @param {import("fastify").FastifyRequest} request
   * @param {import("fastify").FastifyReply} reply
   */
  return function errorHandler (error, request, reply) {
    // These are user-led errors, we do not need to log them.
    if (error.validation) {
      return reply.send(new InvalidRequestApiError(error.message, error))
    }

    if ([400, 401, 403, 404].includes(error.statusCode)) {
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
