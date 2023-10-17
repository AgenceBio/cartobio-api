'use strict'

const { decodeToken, enforceRecord, verifyAgenceBioToken, enforceAnyFastifyDecorator, compareToken, compareOperatorOutputAndToken } = require('../middlewares.js')
const { getOperatorById, getOperatorByNumeroBio, getRecord } = require('../providers/cartobio.js')
const config = require('../config.js')
const host = config.get('host')
const port = config.get('port')
const version = config.get('version')

const merge = require('deepmerge')

/**
 * @typedef {import('fastify').RouteShorthandOptions} RouteShorthandOptions
 * @typedef {import('fastify').FastifySchema} FastifySchema
 *
 * @typedef {FastifySchema} CartobioExtendedFastifySchema
 * @property tags {String[]} - OpenAPI tags
 * @property security {Object[]} - OpenAPI security
 *
 * @typedef {RouteShorthandOptions} CartobioExtendedRouteShorthandOptions
 * @property schema {CartobioExtendedFastifySchema}
 */

/**
 * Deep merge with stacked merge of arrays
 * It then enable multiple schemas with same key (eg: preValidation) to combine middlewares
 * @param  {...CartobioExtendedRouteShorthandOptions} schemas
 * @returns {CartobioExtendedRouteShorthandOptions}
 */
function deepmerge (...schemas) {
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
    tags: [TAGS.CARTOBIO]
  },
  security: [
    { bearerAuth: [] }
  ]
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
 * @param {Boolean} options.mattermost
 * @returns {CartobioExtendedRouteShorthandOptions}
 */
function protectedWithToken ({ oc = false, cartobio = true, mattermost = false } = {}) {
  const requiredDecorators = []
  const root = {
    schema: { tags: [], security: [] },
    onRequest: []
  }

  if (oc) {
    requiredDecorators.push('organismeCertificateur')
    root.schema.tags.push(TAGS.OC)
    root.schema.security.push({ agenceBioAuthorizationAuth: [] })
    root.onRequest.push(verifyAgenceBioToken())
  }

  if (cartobio) {
    requiredDecorators.push('decodedToken')
    root.schema.tags.push(TAGS.CARTOBIO)
    root.schema.security.push({ bearerAuth: [] })
    root.onRequest.push(decodeToken({
      keys: [
        // this one if for the tokens we emit with this application
        config.get('jwtSecret'),
        // and this one if for tokens emitted by the Notification app
        // we do not know their private key, so they share a public key we can verify against
        config.get('notifications.publicKey')
      ]
    }))
  }

  if (mattermost) {
    root.schema.security.push({ tokenHeaderAuth: [] })
    root.onRequest.push(compareToken({
      name: 'mattermostToken',
      token: config.get('mattermost.secret')
    }))
  }

  if (requiredDecorators.length) {
    root.onRequest.push(enforceAnyFastifyDecorator(requiredDecorators))
  }

  return root
}

const enforceSameCertificationBody = {
  preValidation: [
    decodeToken({ keys: [config.get('jwtSecret')] })
  ],

  preSerialization: [
    compareOperatorOutputAndToken({ name: 'decodedToken' })
  ]
}

/*
 * ROUTE Schemas
 */

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const routeWithNumeroBio = {
  schema: {
    params: {
      numeroBio: { type: 'integer' }
    }
  },

  preValidation: [
    enforceRecord({ queryFn: getOperatorByNumeroBio, param: 'numeroBio' })
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

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
const routeWithOperatorId = {
  schema: {
    params: {
      operatorId: { type: 'string', pattern: '^\\d+$' }
    }
  },

  preValidation: [
    enforceRecord({ queryFn: getOperatorById, param: 'operatorId' })
  ]
}

/**
 * @type CartobioExtendedRouteShorthandOptions
 */
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

/**
 * Common Schemas (definitions, mostly)
 */
const commonSchema = {
  $id: 'cartobio',
  type: 'object',
  definitions: {
    numerobio: {
      $id: '#numerobio',
      type: 'number',
      exclusiveMinimum: 0
    },

    geojson: {
      $id: '#geojson',
      type: 'object',
      required: ['type', 'features'],
      properties: {
        type: {
          type: 'string',
          enum: ['FeatureCollection']
        },
        features: {
          type: 'array',
          items: {
            $id: '#geojson-feature',
            type: 'object',
            properties: {
              id: {
                type: 'number',
                minimum: 0
              },
              geometry: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['Polygon', 'MultiPolygon']
                  },
                  coordinates: {
                    type: 'array'
                  }
                }
                // WARNING
                // using the following will somewhat alter the first coordinate
                // instead of being [ [10, -10], [11, -11] ]
                // it will be [ [[10], -10], [[11], -11]]
                // breaking any further geometry operations
                //
                // oneOf: [
                //   // this is how we import them via MesParcelles, Telepac, RPG, and Geofolia
                //   { $ref: '#geojson-polygon' },
                //   // this is how we import features via Cadastre references
                //   { $ref: '#geojson-multipolygon' }
                // ]
              },
              /**
               * TODO make it more explicit, as we lean towards patch updates
               * We will send new data, not the entire dataset.
               * This will also be interesting for the offline-first strategy:
               *    store (mergeable) operations, not the anticipated result state
               */
              properties: {
                type: 'object'
                // it would be awesome to have that list dynamic based on user permissions
                // but maybe that's duplicating code between frontend/backend and that would lead to (other, unknown type of) errors
                // $ref: 'cartobio#feature-editable-properties
              }
            }
          }
        }
      }
    },

    geojsonPolygon: {
      $id: '#geojson-polygon',
      type: 'object',
      required: ['coordinates', 'type'],
      properties: {
        // { coordinates: [ [ [y, x], [y, x],… ] ]}
        coordinates: {
          type: 'array',
          // items are polygon(s)
          items: {
            type: 'array',
            // items are latlong pairs
            items: {
              maxItems: 2,
              minItems: 2,
              type: 'array',
              items: {
                type: 'number'
              }
            }
          }
        },
        type: {
          type: 'string',
          enum: ['Polygon']
        }
      }
    },

    geojsonMultipolygon: {
      $id: '#geojson-multipolygon',
      type: 'object',
      required: ['coordinates', 'type'],
      properties: {
        // { coordinates: [ [[ [y, x], [y, x],… ]] ]}
        coordinates: {
          type: 'array',
          // items are polygons
          items: {
            type: 'array',
            minItems: 1,
            // items are rings
            items: {
              type: 'array',
              minItems: 1,
              // items are latlong pairs
              items: {
                maxItems: 2,
                minItems: 2,
                type: 'array',
                items: {
                  type: 'number'
                }
              }
            }
          }
        },
        type: {
          type: 'string',
          enum: ['MultiPolygon']
        }
      }
    },

    culture: {
      $id: '#feature-culture',
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid'
        },
        CPF: {
          type: 'string',
          pattern: '^(\\d+.)*\\d+$'
        },
        TYPE: {
          type: 'string',
          pattern: '^[A-Z]{3}$'
        },
        surface: {
          type: 'number',
          minimum: 0,
          nullable: true
        },
        date_semis: {
          type: 'string',
          format: 'date',
          nullable: true
        },
        variete: {
          type: 'string',
          nullable: true
        }
      }
    }
  }
}

module.exports = {
  deepmerge,
  swaggerConfig,

  sandboxSchema,
  internalSchema,
  deprecatedSchema,
  hiddenSchema,

  protectedWithToken,
  enforceSameCertificationBody,

  routeWithNumeroBio,
  routeWithOperatorId,
  routeWithPacage,
  routeWithRecordId,

  commonSchema
}
