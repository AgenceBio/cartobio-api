
class UnauthorizedApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 401

    Error.captureStackTrace(this, this.constructor)
  }
}

class InvalidRequestApiError extends Error {
  constructor (status, message, cause) {
    super(message, { cause })
    this.statusCode = status

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
      return reply.send(new InvalidRequestApiError(400, error.message, error))
    }

    sentryClient.captureException(error)

    return reply.code(error.statusCode || 500).send({
      error: 'Server error. We have been notified about and will soon start fixing this issue.'
    })
  }
}

module.exports = {
  FastifyErrorHandler,
  InvalidRequestApiError,
  UnauthorizedApiError
}
