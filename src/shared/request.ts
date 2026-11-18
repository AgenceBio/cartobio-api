import type { FastifyRequest } from 'fastify'
import type { AgenceBioNormalizedOperator, CartoBioOCUser, CartoBioUser, NormalizedRecord, OrganismeCertificateur } from '@agencebio/cartobio-types'
import { ForbiddenApiError, NotFoundApiError, UnauthorizedApiError } from './errors.js'

export function requireUser (request: FastifyRequest): CartoBioUser {
  if (!request.user) throw new UnauthorizedApiError('un jeton d\'API est nécessaire pour accéder à ce contenu.')
  return request.user
}

export function requireOcUser (request: FastifyRequest): CartoBioOCUser {
  const user = requireUser(request)
  const { organismeCertificateur } = user
  if (!organismeCertificateur) throw new ForbiddenApiError('Accès réservé aux organismes certificateurs')
  return { ...user, organismeCertificateur }
}

export function requireOperator (request: FastifyRequest): AgenceBioNormalizedOperator {
  if (!request.operator) throw new NotFoundApiError('Opérateur introuvable')
  return request.operator
}

export function requireOrganismeCertificateur (request: FastifyRequest): OrganismeCertificateur {
  if (!request.organismeCertificateur) throw new UnauthorizedApiError('un jeton d\'API est nécessaire pour accéder à ce contenu.')
  return request.organismeCertificateur
}

export function requireRecord (request: FastifyRequest): NormalizedRecord {
  if (!request.record) throw new NotFoundApiError('Parcellaire introuvable')
  return request.record
}
