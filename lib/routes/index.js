'use strict'

const { decodeToken, enforceToken, compareToken, trackRequest, compareOperatorOutputAndToken } = require('../middlewares.js')
const env = require('../app.js').env()
const { JWT_SECRET, MATTERMOST_SECRET, MATOMO_SITE_ID, MATOMO_TRACKER_URL, NODE_ENV, host, port, version } = env

/** @type {import('@fastify/swagger').SwaggerOptions} */
const swaggerConfig = {
  swagger: {
    info: {
      title: 'CartoBio API',
      version
    },
    host: NODE_ENV === 'production' ? 'cartobio.agencebio.org' : `${host}:${port}`,
    schemes: [NODE_ENV === 'production' ? 'https' : 'http'],
    externalDocs: {
      url: 'https://cartobio.agencebio.org/api',
      description: 'Consulter le guide d\'utilisation de l\'API CartoBio'
    },
    tags: [
      { name: 'Bac à sable', description: 'Pour s\'entraîner à utiliser l\'API' },
      { name: 'Organisme de certification', description: 'Données géographiques à destination des organismes de certification' },
      { name: 'CartoBio', description: 'Interactions avec l\'application cartobio.agencebio.org' }
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
      tokenAuth: {
        type: 'apiKey',
        name: 'access_token',
        in: 'query',
        description: 'Token JWT passé en tant que paramètre d\'URL.'
      }
    }
  }
}

const sandboxSchema = {
  schema: {
    tags: ['Bac à sable']
  }
}

const deprecatedSchema = {
  schema: {
    deprecated: true
  }
}

const ocSchema = {
  schema: {
    tags: ['Organisme de certification']
  }
}

const internalSchema = {
  schema: {
    tags: ['CartoBio']
  }
}

const hiddenSchema = {
  schema: {
    tags: ['X-HIDDEN']
  }
}

/*
 * HOOKS
 */
const protectedRouteOptions = {
  schema: {
    securitySchemes: [
      { bearerAuth: [] },
      { tokenAuth: [] }
    ]
  },

  preValidation: [
    decodeToken({ name: 'decodedToken', JWT_SECRET }),
    enforceToken({ name: 'decodedToken' })
  ]
}

const protectedWithTokenRoute = {
  schema: {
    securitySchemes: [
      { tokenHeaderAuth: [] }
    ]
  },

  preValidation: [
    compareToken({ name: 'mattermostToken', token: MATTERMOST_SECRET })
  ]
}

const trackableRoute = {
  onResponse: NODE_ENV === 'production'
    ? [trackRequest({ MATOMO_SITE_ID, MATOMO_TRACKER_URL })]
    : []
}

const enforceSameCertificationBody = {
  preValidation: [
    decodeToken({ name: 'decodedToken', JWT_SECRET })
  ],

  preSerialization: [
    compareOperatorOutputAndToken({ name: 'decodedToken' })
  ]
}

/*
 * ROUTE Schemas
 */

const routeWithNumeroBio = {
  schema: {
    params: {
      numeroBio: { type: 'integer' }
    }
  }
}

const routeWithRecordId = {
  schema: {
    params: {
      recordId: { type: 'string', format: 'uuid' }
    }
  }
}

const routeWithOperatorId = {
  schema: {
    params: {
      operatorId: { type: 'string', pattern: '^\\d+$' }
    }
  }
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
  swaggerConfig,

  sandboxSchema,
  ocSchema,
  internalSchema,
  deprecatedSchema,
  hiddenSchema,

  protectedRouteOptions,
  protectedWithTokenRoute,
  trackableRoute,
  enforceSameCertificationBody,

  routeWithNumeroBio,
  routeWithOperatorId,
  routeWithPacage,
  routeWithRecordId
}
