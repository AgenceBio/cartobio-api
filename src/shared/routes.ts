import {
  decodeUserToken,
  enforceAdminRole,
  enforceRecordAndOperator,
  enforceOperator,
  verifyAgenceBioToken,
  enforceAnyFastifyDecorator,
  compareOperatorOutputAndToken,
  getRequestOc,
  checkCertification,
  haveRightToUpdate
} from './middlewares.js'
import { getRecord } from './parcellaires/parcellaires.service.js'
import config from '../config/env.js'
import merge from 'deepmerge'
import { apiErrorSchema, auditParamsSchema, numeroBioParamsSchema } from '@agencebio/cartobio-types'
import { z } from 'zod'
import type {
  RouteShorthandOptions,
  FastifySchema,
  FastifyRequest,
  FastifyReply,
  onRequestHookHandler,
  preSerializationHookHandler
} from 'fastify'

export interface CartobioExtendedRouteShorthandOptions extends RouteShorthandOptions {
  schema?: FastifySchema
}

export type WithSchema<B extends CartobioExtendedRouteShorthandOptions, S extends FastifySchema> = Omit<B, 'schema'> & {
  schema: Omit<NonNullable<B['schema']>, keyof S> & S
}

export type ProtectedRoute = {
  schema: { security: Array<Record<string, string[]>> }
  onRequest: Array<onRequestHookHandler | ((request: FastifyRequest, reply: FastifyReply) => Promise<void>)>
  preSerialization: preSerializationHookHandler[]
}

/**
 * Deep merge with stacked merge of arrays
 * It then enable multiple schemas with same key (eg: preValidation) to combine middlewares
 */
function mergeSchemas(...schemas: CartobioExtendedRouteShorthandOptions[]): CartobioExtendedRouteShorthandOptions {
  return merge.all(schemas, {
    isMergeableObject: (value) =>
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof z.ZodType) &&
      !(value instanceof RegExp) &&
      !(value instanceof Date),
    arrayMerge(target, source, options) {
      if (!options) throw new Error('deepmerge : options absentes')
      const destination = target.slice()

      source.forEach((item, index): void => {
        if (typeof destination[index] === 'undefined') {
          destination[index] = options.cloneUnlessOtherwiseSpecified(item, options)
        } else if (options.isMergeableObject(item)) {
          destination[index] = merge(target[index], item, options)
        } else if (target.indexOf(item) === -1) {
          destination.push(item)
        }
      })

      return destination
    }
  })
}

function withSchema<B extends CartobioExtendedRouteShorthandOptions, S extends FastifySchema>(
  base: B,
  schema: S
): WithSchema<B, S> {
  return { ...base, schema: { ...base.schema, ...schema } } as WithSchema<B, S>
}

function describedResponse(description: string): z.ZodUnknown {
  return z.unknown().meta({ description })
}

function apiError(description: string): typeof apiErrorSchema {
  return apiErrorSchema.meta({ description })
}

const commonErrorResponses = {
  401: apiError("Jeton d'accès absent, invalide, expiré ou sans droit sur cette ressource"),
  500: apiError('Erreur serveur')
}

const TAGS = {
  SYSTEME: 'Système',
  AUTH: 'Authentification',
  API_PARCELLAIRE: 'API parcellaire',
  SUIVI_API_PARCELLAIRE: "Suivi de l'API parcellaire",
  OPERATEURS: 'Opérateurs',
  TABLEAU_DE_BORD: 'Tableau de bord',
  PARCELLAIRES: 'Parcellaires',
  PARCELLES: 'Parcelles',
  IMPORT: 'Import de parcellaire',
  GEOMETRIE: 'Géométrie',
  EXPORTS: 'Exports',
  REFERENTIELS: 'Référentiels'
} as const

const internalSchema: CartobioExtendedRouteShorthandOptions = {
  schema: {
    security: [{ bearerAuth: [] }]
  }
}

const hiddenSchema: CartobioExtendedRouteShorthandOptions = {
  schema: {
    tags: ['X-HIDDEN']
  }
}

/**
 * Use to protect a route with one or more authentication methods
 */
function protectedWithToken({ oc = false, cartobio = true, admin = false } = {}): ProtectedRoute {
  const requiredDecorators: Array<'user' | 'organismeCertificateur'> = []
  const root: ProtectedRoute = {
    schema: { security: [] },
    onRequest: [],
    preSerialization: []
  }

  if (oc) {
    requiredDecorators.push('organismeCertificateur')
    root.schema.security.push({ agenceBioAuthorizationAuth: [] })
    root.onRequest.push(verifyAgenceBioToken())
  }

  if (cartobio || admin) {
    requiredDecorators.push('user')
    root.schema.security.push({ bearerAuth: [] })
    root.onRequest.push(decodeUserToken(config.get('jwtSecret')))
  }

  if (requiredDecorators.length) {
    root.onRequest.push(enforceAnyFastifyDecorator(requiredDecorators))
  }

  if (oc || cartobio) {
    root.preSerialization.push(compareOperatorOutputAndToken(getRequestOc))
  }

  if (admin) {
    root.onRequest.push(enforceAdminRole())
  }

  return root
}

/*
 * ROUTE Schemas
 */

const operatorFromNumeroBio: CartobioExtendedRouteShorthandOptions = {
  schema: {
    params: numeroBioParamsSchema
  },

  preValidation: [enforceOperator({ param: 'numeroBio' })]
}

const checkCertificationStatus = {
  schema: {
    params: numeroBioParamsSchema
  },

  preValidation: [async (request: FastifyRequest): Promise<void> => checkCertification(request)]
}

const operatorFromRecordId: CartobioExtendedRouteShorthandOptions = {
  schema: {
    params: auditParamsSchema
  },

  preValidation: [enforceRecordAndOperator({ queryFn: getRecord, param: 'recordId' }), haveRightToUpdate()]
}

export {
  mergeSchemas,
  withSchema,
  describedResponse,
  apiError,
  commonErrorResponses,
  TAGS,
  internalSchema,
  hiddenSchema,
  checkCertificationStatus,
  protectedWithToken,
  operatorFromNumeroBio,
  operatorFromRecordId
}
