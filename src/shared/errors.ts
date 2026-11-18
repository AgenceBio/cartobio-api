import createError from '@fastify/error'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import type { HTTPError as GotHttpError } from 'got'
import type { ApiError, ValidationIssue } from '@agencebio/cartobio-types'


const ExpiredCredentialsApiError = createError('EXPIRED_CREDENTIALS', 'Accès refusé : ce jeton n\'est plus valide (%s).', 401)
const InvalidCredentialsApiError = createError('INVALID_CREDENTIALS', 'Accès refusé : %s', 401)
const InvalidRequestApiError = createError('INVALID_API_REQUEST', '%s', 400)
const MissingGeometryApiError = createError('MISSING_GEOMETRY', '%s', 400)
const NotFoundApiError = createError('NOT_FOUND', '%s', 404)
const UnauthorizedApiError = createError('UNAUTHORIZED', 'Accès refusé : %s', 401)
const ForbiddenApiError = createError('FORBIDDEN', 'Accès refusé : %s', 403)
const BadGatewayApiError = createError('BAD_GATEWAY', 'Erreur serveur : %s', 502)
const PreconditionFailedApiError = createError('PRECONDITION_FAILED', 'La ressource a été modifiée depuis la dernière requête.', 412)

const hasProperty = <K extends string>(value: unknown, key: K): value is Record<K, unknown> =>
  typeof value === 'object' && value !== null && key in value

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

const getErrorCode = (error: unknown): unknown => hasProperty(error, 'code') ? error.code : undefined

const getResponseStatusCode = (error: unknown): unknown =>
  hasProperty(error, 'response') && hasProperty(error.response, 'statusCode') ? error.response.statusCode : undefined

const isHandledError = <T>(error: T): error is T & { statusCode: number } => {
  const statusCode = (error as { statusCode?: unknown } | null | undefined)?.statusCode

  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
}

const validationErrorBody = (location: string, validation: { instancePath: string; message?: string }[]): ApiError => {
  const details: ValidationIssue[] = validation.map(({ instancePath, message }) => ({
    location,
    path: instancePath.split('/').filter(Boolean).join('.'),
    message: message ?? 'Valeur invalide'
  }))
  const [first] = details
  const others = details.length - 1
  const summary = first.path ? `${first.path} : ${first.message}` : first.message

  return {
    statusCode: 400,
    code: 'INVALID_API_REQUEST',
    error: 'Bad Request',
    message: `Requête invalide — ${summary}${others > 0 ? ` (et ${others} autre${others > 1 ? 's' : ''} erreur${others > 1 ? 's' : ''})` : ''}`,
    details
  }
}

const errorHandler = (error: Error & { validation?: unknown; validationContext?: string; statusCode?: number } & GotHttpError, request: FastifyRequest, reply: FastifyReply) => {
  // These are user-led errors, we do not need to log them.
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send(validationErrorBody(error.validationContext ?? 'body', error.validation))
  }

  if (error.validation) {
    return reply.send(new InvalidRequestApiError(error.message, { cause: error }))
  }

  // All handled errors (status code < 500) are already formatted to be exposed to the client
  if (isHandledError(error)) {
    return reply.code(error.statusCode).send(error)
  }

  // We can also expose 502 error to the client even if it's not a handled error
  if (error.statusCode != null && error.statusCode > 500) {
    return reply.code(error.statusCode).send(error)
  }

  request.log.error({ err: error }, error.message)

  // All other errors are internal server errors which should not be exposed to the client
  return reply.send(new Error('Erreur serveur. Nous avons été informés et résoudrons ceci au plus vite.', {
    cause: error.message
  }))
}

export {
  ExpiredCredentialsApiError,
  InvalidCredentialsApiError,
  InvalidRequestApiError,
  MissingGeometryApiError,
  NotFoundApiError,
  UnauthorizedApiError,
  ForbiddenApiError,
  BadGatewayApiError,
  PreconditionFailedApiError,
  isHandledError,
  getErrorMessage,
  getErrorCode,
  getResponseStatusCode,
  errorHandler
}
