class ApiError extends Error {
  constructor (message, cause) {
    super(message, { cause })
    this.statusCode = 500

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
   * @param {ApiError} error
   * @param {import("./middlewares").FastifyRequest} request
   * @param {import("fastify").FastifyReply} reply
   */
  return function errorHandler (error, request, reply) {
    // These are user-led errors, we do not need to log them per say.
    if (error.validation) {
      return reply.send(new InvalidRequestApiError(400, error.message, error))
    }

    sentryClient.captureException(error)

    this.log.error({
      message: error.message,
      stack: error.stack,
      remoteResponse: error.response ? error.response.body : null,
      remoteRequest: error.request ? error.request : null
    })

    return reply.code(error.statusCode || 500).send({
      requestId: request.id,
      error: `${error.message}. We have been notified about and will soon start fixing this issue.`
    })
  }
}

module.exports = {
  ApiError,
  FastifyErrorHandler,
  InvalidRequestApiError
}
