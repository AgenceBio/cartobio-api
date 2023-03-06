'use strict'

const { decodeToken, enforceToken, compareToken, trackRequest, compareOperatorOutputAndToken } = require('../middlewares.js')
const config = require('../config.js')
const siteId = config.get('matomo.siteId')
const trackerUrl = config.get('matomo.trackerUrl')
const host = config.get('host')
const port = config.get('port')
const version = config.get('version')

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
    decodeToken({
      name: 'decodedToken',
      keys: [
        // this one if for the tokens we emit with this application
        config.get('jwtSecret'),
        // and this one if for tokens emitted by the Notification app
        // we do not know their private key, so they share a public key we can verify against
        config.get('notifications.publicKey')
      ]
    }),
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
    compareToken({ name: 'mattermostToken', token: config.get('mattermost.secret') })
  ]
}

const trackableRoute = {
  onResponse: config.get('env') === 'production'
    ? [trackRequest({ siteId, trackerUrl })]
    : []
}

const enforceSameCertificationBody = {
  preValidation: [
    decodeToken({ name: 'decodedToken', keys: [config.get('jwtSecret')] })
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
