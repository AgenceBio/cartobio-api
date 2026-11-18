import createError from '@fastify/error'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import { z, ZodError } from 'zod'
import type { ApiError, ValidationIssue } from '@agencebio/cartobio-types'
import config from '../config/env.js'

export const ExpiredCredentialsApiError = createError(
  'EXPIRED_CREDENTIALS',
  "Accès refusé : ce jeton n'est plus valide (%s).",
  401
)
export const InvalidCredentialsApiError = createError('INVALID_CREDENTIALS', 'Accès refusé : %s', 401)
export const InvalidRequestApiError = createError('INVALID_API_REQUEST', '%s', 400)
export const MissingGeometryApiError = createError('MISSING_GEOMETRY', '%s', 400)
export const NotFoundApiError = createError('NOT_FOUND', '%s', 404)
export const UnauthorizedApiError = createError('UNAUTHORIZED', 'Accès refusé : %s', 401)
export const ForbiddenApiError = createError('FORBIDDEN', 'Accès refusé : %s', 403)
export const BadGatewayApiError = createError('BAD_GATEWAY', 'Erreur serveur : %s', 502)
export const PreconditionFailedApiError = createError(
  'PRECONDITION_FAILED',
  'La ressource a été modifiée depuis la dernière requête.',
  412
)

const hasProperty = <K extends string>(value: unknown, key: K): value is Record<K, unknown> =>
  typeof value === 'object' && value !== null && key in value

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getErrorCode(error: unknown): unknown {
  if (hasProperty(error, 'code')) return error.code
  return hasProperty(error, 'cause') ? getErrorCode(error.cause) : undefined
}

const getErrorConstraint = (error: unknown): unknown => {
  if (hasProperty(error, 'constraint')) return error.constraint
  return hasProperty(error, 'cause') ? getErrorConstraint(error.cause) : undefined
}

export function getResponseStatusCode(error: unknown): unknown {
  return hasProperty(error, 'response') && hasProperty(error.response, 'statusCode')
    ? error.response.statusCode
    : undefined
}

export function isHandledError<T>(error: T): error is T & { statusCode: number } {
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
  const summary = first?.path ? `${first.path} : ${first.message}` : (first?.message ?? 'Valeur invalide')

  return {
    statusCode: 400,
    code: 'INVALID_API_REQUEST',
    error: 'Bad Request',
    message: `Requête invalide — ${summary}${others > 0 ? ` (et ${others} autre${others > 1 ? 's' : ''} erreur${others > 1 ? 's' : ''})` : ''}`,
    details
  }
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const body = validationErrorBody(error.validationContext ?? 'body', error.validation)
    if (config.get('env') === 'dev') request.log.warn({ details: body.details }, body.message)
    return reply.code(400).send(body)
  }

  if (error instanceof ZodError) {
    return reply.send(new InvalidRequestApiError(z.prettifyError(error), { cause: error }))
  }

  if (error.validation) {
    return reply.send(new InvalidRequestApiError(error.message, { cause: error }))
  }

  if (getErrorConstraint(error) === 'parcelles_commune_communes_fid_fkey') {
    return reply.send(new InvalidRequestApiError('Code commune inconnu.', { cause: error }))
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
  return reply.send(
    new Error('Erreur serveur. Nous avons été informés et résoudrons ceci au plus vite.', {
      cause: error.message
    })
  )
}
