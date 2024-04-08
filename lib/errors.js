const createError = require('@fastify/error')

/**
 * @typedef {import('got').HTTPError} GotHttpError
 */

const ExpiredCredentialsApiError = createError('EXPIRED_CREDENTIALS', 'Accès refusé : ce jeton n\'est plus valide (%s).', 401)
const InvalidCredentialsApiError = createError('INVALID_CREDENTIALS', 'Accès refusé : %s', 401)
const InvalidRequestApiError = createError('INVALID_API_REQUEST', '%s', 400)
const NotFoundApiError = createError('NOT_FOUND', '%s', 404)
const UnauthorizedApiError = createError('UNAUTHORIZED', 'Accès refusé : %s', 401)

/**
 * Handle errors in fastify
 * @returns {function}
 */
function FastifyErrorHandler () {
  /**
   * @param {Error & {validation: any?, statusCode: Number?} & GotHttpError} error
   * @param {import("fastify").FastifyRequest} request
   * @param {import("fastify").FastifyReply} reply
   */
  return function errorHandler (error, request, reply) {
    // These are user-led errors, we do not need to log them.
    if (error.validation) {
      return reply.send(new InvalidRequestApiError(error.message, { cause: error }))
    }

    // error can originate either from Fastify or Got
    // and they handle responses a bit differently
    const { statusCode } = error.response ?? error

    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send(error)
    }

    if (process.env.NODE_ENV === 'test') {
      // Just throw error without returning anything in test (cleaner log)
      throw error
    } else if (process.env.NODE_ENV !== 'production') {
      // Stack traces on console in development
      console.error(error)
    }

    return reply.code(500).send({
      error: 'Erreur serveur. Nous avons été informés et résoudrons ceci au plus vite.'
    })
  }
}

module.exports = {
  ExpiredCredentialsApiError,
  FastifyErrorHandler,
  InvalidCredentialsApiError,
  InvalidRequestApiError,
  NotFoundApiError,
  UnauthorizedApiError
}
