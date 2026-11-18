import type { FastifyRequest } from 'fastify'
import type { AgenceBioNormalizedOperator, CartoBioOCUser, NormalizedRecord, OrganismeCertificateur } from '@agencebio/cartobio-types'
import { NotFoundApiError, UnauthorizedApiError } from './errors.js'

export function requireUser (request: FastifyRequest): CartoBioOCUser {
  if (!request.user) throw new UnauthorizedApiError('un jeton d\'API est nécessaire pour accéder à ce contenu.')
  return request.user
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
