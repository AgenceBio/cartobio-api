const fp = require('fastify-plugin')
const { decodeUserToken, enforceRecord, enforceRecordAndOperator, enforceOperator, verifyAgenceBioToken, enforceAnyFastifyDecorator, compareOperatorOutputAndToken, checkCertification } = require('../middlewares.js')
const { getRecord } = require('../providers/cartobio.js')
const config = require('../config.js')
const host = config.get('host')
const port = config.get('port')
const version = config.get('version')

const merge = require('deepmerge')

/**
 * @typedef {import('fastify').RouteShorthandOptions} RouteShorthandOptions
 * @typedef {import('fastify').FastifySchema} FastifySchema
 * @typedef {import('../providers/cartobio').OrganismeCertificateur} OrganismeCertificateur

 * @typedef {FastifySchema} CartobioExtendedFastifySchema
 * @property tags {String[]} - OpenAPI tags
 * @property security {Object[]} - OpenAPI security
 *
 * @typedef {RouteShorthandOptions} CartobioExtendedRouteShorthandOptions
 * @property schema {CartobioExtendedFastifySchema}
 */

async function CartoBioDecoratorsPlugin (app) {
  // Routes to protect with a JSON Web Token
  app.decorateRequest('user', null)
  app.decorateRequest('organismeCertificateur', null)

  // Requests can be decorated by an operator (associated to a numeroBio)
  app.decorateRequest('operator', null)
  // Requests can be decorated by a given Record too (associated to a recordId)
  app.decorateRequest('record', null)

  // Requests can be decorated by an API result when we do custom stream parsing
  app.decorateRequest('APIResult', null)
}

/**
 * Deep merge with stacked merge of arrays
 * It then enable multiple schemas with same key (eg: preValidation) to combine middlewares
 * @param  {...CartobioExtendedRouteShorthandOptions} schemas
 * @returns {CartobioExtendedRouteShorthandOptions}
 */
function mergeSchemas (...schemas) {
  return merge.all(schemas, {
    arrayMerge (target, source, options) {
      const destination = target.slice()

      source.forEach((item, index) => {
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

/** @enum {String} */
const TAGS = {
  CARTOBIO: 'cartobio',
  OC: 'certification',
  SANDBOX: 'sandbox'
}

/** @type {import('@fastify/swagger').SwaggerOptions} */
const swaggerConfig = {
  swagger: {
    info: {
      title: 'CartoBio API',
      version
    },
    host: config.get('env') === 'production' ? 'cartobio.agencebio.org' : `${host}:${port}`,
    schemes: [config.get('env') === 'production' ? 'https' : 'http'],
    externalDocs: {
      url: 'https://cartobio.agencebio.org/api',
      description: 'Consulter le guide d\'utilisation de l\'API CartoBio'
    },
    tags: [
      { name: TAGS.SANDBOX, description: 'Pour s\'entraîner à utiliser l\'API' },
      { name: TAGS.OC, description: 'Données géographiques à destination des organismes de certification' },
      { name: TAGS.CARTOBIO, description: 'Interactions avec l\'application cartobio.agencebio.org' }
    ],
    securityDefinitions: {
      bearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'Token JWT passé en tant qu\'entête HTTP (donc préfixé par `Bearer `).'
      },
      tokenHeaderAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'Token passé en tant qu\'entête HTTP (donc préfixé par `Token `).'
      },
      agenceBioAuthorizationAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'Token délivré par l\'Agence Bio, passé dans l\'entête HTTP `Authorization`.'
      }
    }
  }
}

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const sandboxSchema = {
  schema: {
    tags: [TAGS.SANDBOX]
  }
}

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const deprecatedSchema = {
  schema: {
    deprecated: true
  }
}

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const internalSchema = {
  schema: {
    tags: [TAGS.CARTOBIO],
    security: [
      { bearerAuth: [] }
    ]
  }
}

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const hiddenSchema = {
  schema: {
    tags: ['X-HIDDEN']
  }
}

/*
 * Use to protect a route with one or more authentication methods
 * @param {Object} options
 * @param {Boolean} options.oc
 * @param {Boolean} options.cartobio
 * @returns {CartobioExtendedRouteShorthandOptions}
 */
function protectedWithToken ({ oc = false, cartobio = true } = {}) {
  const requiredDecorators = []
  const root = {
    schema: { tags: [], security: [] },
    onRequest: [],
    preSerialization: []
  }

  if (oc) {
    const name = 'organismeCertificateur'
    requiredDecorators.push(name)
    root.schema.tags.push(TAGS.OC)
    root.schema.security.push({ agenceBioAuthorizationAuth: [] })
    root.onRequest.push(verifyAgenceBioToken())
    root.preSerialization.push(compareOperatorOutputAndToken((request) => request.organismeCertificateur))
  }

  if (cartobio) {
    const name = 'user'
    requiredDecorators.push(name)
    root.schema.tags.push(TAGS.CARTOBIO)
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

  if (requiredDecorators.length) {
    root.onRequest.push(enforceAnyFastifyDecorator(requiredDecorators))
  }

  return root
}

const operatorsSchema = {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        limit: { type: 'integer' },
        offset: { type: 'integer' }
      }
    }
  }
}

const certificationBodySearchSchema = {
  schema: {
    body: {
      type: 'object',
      required: ['input'],
      properties: {
        input: {
          type: 'string'
        },
        page: {
          type: 'integer',
          default: 1
        },
        sort: {
          type: 'string',
          enum: ['nom', 'engagement_date', 'notifications', 'audit_date', 'statut'],
          default: 'audit_date'
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          default: 'desc'
        }
      }
    }
  }
}

const geofoliaImportSchema = {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        year: {
          type: 'number',
          minimum: new Date().getUTCFullYear() - 3,
          maximum: new Date().getUTCFullYear(),
          default: new Date().getUTCFullYear()
        }
      }
    }
  }
}

/*
 * ROUTE Schemas
 */

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const operatorFromNumeroBio = {
  schema: {
    params: {
      numeroBio: { type: 'integer' }
    }
  },

  preValidation: [
    enforceOperator({ param: 'numeroBio' })
  ]
}

const checkCertificationStatus = {
  schema: {
    params: {
      numeroBio: { type: 'integer' }
    }
  },

  preValidation: [
    async (request) => checkCertification(request)
  ]
}

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const operatorFromRecordId = {
  schema: {
    params: {
      recordId: { type: 'string', format: 'uuid' },
      featureId: { type: 'number' }
    }
  },

  preValidation: [
    enforceRecordAndOperator({ queryFn: getRecord, param: 'recordId' })
  ]
}

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const routeWithRecordId = {
  schema: {
    params: {
      recordId: { type: 'string', format: 'uuid' },
      featureId: { type: 'number' }
    }
  },

  preValidation: [
    enforceRecord({ queryFn: getRecord, param: 'recordId' })
  ]
}

const routeWithPacage = {
  schema: {
    params: {
      numeroPacage: {
        type: 'string',
        pattern: '^\\d{9}$'
      }
    }
  }
}

module.exports = {
  mergeSchemas,
  swaggerConfig,

  sandboxSchema,
  internalSchema,
  deprecatedSchema,
  hiddenSchema,

  operatorsSchema,
  certificationBodySearchSchema,
  geofoliaImportSchema,

  checkCertificationStatus,
  protectedWithToken,

  operatorFromNumeroBio,
  operatorFromRecordId,
  routeWithPacage,
  routeWithRecordId,

  CartoBioDecoratorsPlugin: fp(CartoBioDecoratorsPlugin)
}
