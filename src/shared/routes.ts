import { decodeUserToken, enforceAdminRole, enforceRecord, enforceRecordAndOperator, enforceOperator, verifyAgenceBioToken, enforceAnyFastifyDecorator, compareOperatorOutputAndToken, checkCertification, haveRightToUpdate } from './middlewares.js'
import { getRecord } from './parcellaires/parcellaires.service.js'
import config from '../config/env.js'
import merge from 'deepmerge'
import { apiErrorSchema, auditParamsSchema, numeroBioParamsSchema } from '@agencebio/cartobio-types'
import { z } from 'zod'
import type { RouteShorthandOptions, FastifySchema, FastifyRequest, FastifyReply, onRequestHookHandler, preSerializationHookHandler } from 'fastify'

export interface CartobioExtendedRouteShorthandOptions extends RouteShorthandOptions {
  schema?: FastifySchema
}

/**
 * Deep merge with stacked merge of arrays
 * It then enable multiple schemas with same key (eg: preValidation) to combine middlewares
 */
function mergeSchemas (...schemas: CartobioExtendedRouteShorthandOptions[]): CartobioExtendedRouteShorthandOptions {
  return merge.all(schemas, {
    isMergeableObject: (value) => value !== null && typeof value === 'object' &&
      !(value instanceof z.ZodType) && !(value instanceof RegExp) && !(value instanceof Date),
    arrayMerge (target, source, options) {
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


function withSchema<B extends CartobioExtendedRouteShorthandOptions, S extends FastifySchema> (base: B, schema: S) {
  return { ...base, schema: { ...base.schema, ...schema } } as Omit<B, 'schema'> & {
    schema: Omit<NonNullable<B['schema']>, keyof S> & S
  }
}


function describedResponse (description: string) {
  return z.unknown().meta({ description })
}


function apiError (description: string) {
  return apiErrorSchema.meta({ description })
}

const commonErrorResponses = {
  401: apiError('Jeton d\'accès absent, invalide, expiré ou sans droit sur cette ressource'),
  500: apiError('Erreur serveur')
}


const TAGS = {
  SYSTEME: 'Système',
  AUTH: 'Authentification',
  API_PARCELLAIRE: 'API parcellaire',
  SUIVI_API_PARCELLAIRE: 'Suivi de l\'API parcellaire',
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
    security: [
      { bearerAuth: [] }
    ]
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
function protectedWithToken ({ oc = false, cartobio = true, admin = false } = {}) {
  const requiredDecorators: Array<'user' | 'organismeCertificateur'> = []
  const root: {
    schema: { security: Array<Record<string, string[]>> }
    onRequest: Array<onRequestHookHandler | ((request: FastifyRequest, reply: FastifyReply) => Promise<void>)>
    preSerialization: preSerializationHookHandler[]
  } = {
    schema: { security: [] },
    onRequest: [],
    preSerialization: []
  }

  if (oc) {
    const name = 'organismeCertificateur'
    requiredDecorators.push(name)
    root.schema.security.push({ agenceBioAuthorizationAuth: [] })
    root.onRequest.push(verifyAgenceBioToken())
    root.preSerialization.push(compareOperatorOutputAndToken((request) => request.organismeCertificateur))
  }

  if (cartobio) {
    const name = 'user'
    requiredDecorators.push(name)
    root.schema.security.push({ bearerAuth: [] })
    root.onRequest.push(decodeUserToken({
      keys: [
        // this one if for the tokens we emit with this application
        config.get('jwtSecret'),
        // and this one if for tokens emitted by the Notification app
        // we do not know their private key, so they share a public key we can verify against
        config.get('notifications.publicKey')
      ]
    }))
    root.preSerialization.push(compareOperatorOutputAndToken((request) => request.user?.organismeCertificateur))
  }

  if (admin) {
    const name = 'user'
    if (!requiredDecorators.includes(name)) requiredDecorators.push(name)
    root.schema.security.push({ bearerAuth: [] })
    root.onRequest.push(decodeUserToken({
      keys: [
        // this one if for the tokens we emit with this application
        config.get('jwtSecret'),
        // and this one if for tokens emitted by the Notification app
        // we do not know their private key, so they share a public key we can verify against
        config.get('notifications.publicKey')
      ]
    }))
    root.onRequest.push(enforceAdminRole())
  }

  if (requiredDecorators.length) {
    root.onRequest.push(enforceAnyFastifyDecorator(requiredDecorators))
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

  preValidation: [
    enforceOperator({ param: 'numeroBio' })
  ]
}

const checkCertificationStatus = {
  schema: {
    params: numeroBioParamsSchema
  },

  preValidation: [
    async (request: FastifyRequest): Promise<void> => checkCertification(request)
  ]
}

const operatorFromRecordId: CartobioExtendedRouteShorthandOptions = {
  schema: {
    params: auditParamsSchema
  },

  preValidation: [
    enforceRecordAndOperator({ queryFn: getRecord, param: 'recordId' }),
    haveRightToUpdate()
  ]
}

const routeWithRecordId: CartobioExtendedRouteShorthandOptions = {
  schema: {
    params: auditParamsSchema
  },

  preValidation: [
    enforceRecord({ queryFn: getRecord, param: 'recordId' })
  ]
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
  operatorFromRecordId,
  routeWithRecordId
}
