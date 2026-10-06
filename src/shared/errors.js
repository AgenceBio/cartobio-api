const createError = require('@fastify/error')

/**
 * @typedef {import('got').HTTPError} GotHttpError
 */

const ExpiredCredentialsApiError = createError('EXPIRED_CREDENTIALS', 'Accès refusé : ce jeton n\'est plus valide (%s).', 401)
const InvalidCredentialsApiError = createError('INVALID_CREDENTIALS', 'Accès refusé : %s', 401)
const InvalidRequestApiError = createError('INVALID_API_REQUEST', '%s', 400)
const NotFoundApiError = createError('NOT_FOUND', '%s', 404)
const UnauthorizedApiError = createError('UNAUTHORIZED', 'Accès refusé : %s', 401)
const ForbiddenApiError = createError('FORBIDDEN', 'Accès refusé : %s', 403)
const BadGatewayApiError = createError('BAD_GATEWAY', 'Erreur serveur : %s', 502)
const PreconditionFailedApiError = createError('PRECONDITION_FAILED', 'La ressource a été modifiée depuis la dernière requête.', 412)

const isHandledError = (error) => {
  const { statusCode } = error

  return statusCode >= 400 && statusCode < 500
}

/**
 * @param {Error & {validation: any?, statusCode: Number?} & GotHttpError} error
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} reply
 */
const errorHandler = (error, request, reply) => {
  // These are user-led errors, we do not need to log them.
  if (error.validation) {
    return reply.send(new InvalidRequestApiError(error.message, { cause: error }))
  }

  // All handled errors (status code < 500) are already formatted to be exposed to the client
  if (isHandledError(error)) {
    return reply.code(error.statusCode).send(error)
  }

  // We can also expose 502 error to the client even if it's not a handled error (i.e. it is reported to Sentry)
  if (error.statusCode > 500) {
    return reply.code(error.statusCode).send(error)
  }

  if (process.env.NODE_ENV === 'test') {
    // Just throw error without returning anything in test (cleaner log)
    console.error(error)
  } else if (process.env.NODE_ENV !== 'production') {
    // Stack traces on console in development
    console.error(error)
  }

  // All other errors are internal server errors which should not be exposed to the client
  return reply.send(new Error('Erreur serveur. Nous avons été informés et résoudrons ceci au plus vite.', {
    cause: error.message
  }))
}

module.exports = {
  ExpiredCredentialsApiError,
  InvalidCredentialsApiError,
  InvalidRequestApiError,
  NotFoundApiError,
  UnauthorizedApiError,
  ForbiddenApiError,
  BadGatewayApiError,
  PreconditionFailedApiError,
  isHandledError,
  errorHandler
}
