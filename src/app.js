'use strict'

const Sentry = require('@sentry/node')
const config = require('./config/env.js')
config.validate({ allowed: 'strict' })

// https://github.com/getsentry/sentry-javascript/blob/8.0.0-alpha.5/docs/v8-node.md
// Sentry error reporting setup
// Application is hosted on localhost:8000 by default
const reportErrors = config.get('reportErrors')
if (reportErrors) {
  const sentryOptions = {
    dsn: config.get('sentry.dsn'),
    environment: config.get('environment'),
    includeLocalVariables: true,
    integrations: [
      Sentry.extraErrorDataIntegration(),
      Sentry.localVariablesIntegration()
    ],
    beforeSend (event, hint) {
      const error = hint.originalException
      if (isHandledError(error)) {
        return null
      }

      return event
    },
    tracesSampleRate: config.get('environment') === 'production' ? 0.2 : 1
  }

  if (config.get('environment') === 'production') {
    sentryOptions.release = config.get('version')
  } else if (
    config.get('environment') === 'staging' ||
    config.get('environment') === 'test'
  ) {
    sentryOptions.release = process.env.SENTRY_RELEASE
  }

  Sentry.init(sentryOptions)
}

const app = require('fastify')({
  logger: config.get('env') !== 'test',
  ajv: {
    plugins: [require('ajv-formats')],
    customOptions: {
      strict: false
    }
  }
})

const dbPlugin = require('./plugins/db.js')
const httpPlugin = require('./plugins/http.js')
const swaggerPlugin = require('./plugins/swagger.js')
const jwtPlugin = require('./plugins/jwt.js')
const fastifyOauth = require('@fastify/oauth2')
const LRUCache = require('mnemonist/lru-map-with-delete')
const { randomUUID } = require('node:crypto')
const { createSigner } = require('fast-jwt')
const { errorHandler, isHandledError } = require('../src/shared/errors.js')

const DURATION_ONE_DAY = 1000 * 60 * 60 * 24
const sign = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_DAY * 30 })

app.setErrorHandler(errorHandler)
if (reportErrors) {
  Sentry.setupFastifyErrorHandler(app)
}

// Global plugins
app.register(dbPlugin)
app.register(httpPlugin)

// SSO Agence Bio
const stateCache = new LRUCache(50)
app.register(fastifyOauth, {
  name: 'agenceBioOAuth2',
  scope: ['openid'],
  tags: ['X-HIDDEN'],
  credentials: {
    client: {
      id: config.get('notifications.sso.clientId'),
      secret: config.get('notifications.sso.clientSecret')
    },
    auth: {
      authorizeHost: config.get('notifications.sso.host'),
      authorizePath: '/oauth2/auth',
      tokenHost: config.get('notifications.sso.host'),
      tokenPath: '/oauth2/token',
      revokePath: '/oauth2/revoke'
    },
    options: {
      // uncomment if 'client_secret_post' is required instead of 'client_secret_basic'
      // which is common when we get a '401 Unauthorized' response from SSO
      authorizationMethod: config.get('notifications.sso.authorizationMethod')
    }
  },
  startRedirectPath: '/api/auth-provider/agencebio/login',
  callbackUri: config.get('notifications.sso.callbackUri'),
  generateStateFunction (request) {
    const state = randomUUID()
    stateCache.set(state, {
      mode: request.query?.mode,
      returnto: request.query?.returnto
    })
    return state
  },
  checkStateFunction ({ query }, next) {
    if (stateCache.has(query.state)) {
      return next()
    }
    next(new Error('Invalid state'))
  },
  cookie: {
    secure: true,
    sameSite: 'strict'
  }
})

app.register(fastifyOauth, {
  name: 'geofoliaOAuth2',
  scope: [config.get('geofolia.api.scope')],
  tags: ['X-HIDDEN'],
  credentials: {
    client: {
      id: config.get('geofolia.oauth.clientId'),
      secret: config.get('geofolia.oauth.clientSecret')
    },
    auth: {
      authorizeHost: config.get('geofolia.oauth.host'),
      authorizePath: `/${config.get('geofolia.oauth.tenant')}/oauth2/v2.0/auth`,
      tokenHost: config.get('geofolia.oauth.host'),
      tokenPath: `/${config.get('geofolia.oauth.tenant')}/oauth2/v2.0/token`,
      revokePath: `/${config.get('geofolia.oauth.tenant')}/oauth2/v2.0/revoke`
    }
  },
  // startRedirectPath: '/api/auth-provider/geofolia/login',
  // callbackUri: '/api/auth-provider/geofolia/callback'
  startRedirectPath: '/api/login/geofolia',
  callbackUri: 'http://127.0.0.1:8000/api/login/geofolia/callback'
})

app.register(swaggerPlugin)
app.register(jwtPlugin)

app.register(require('./modules/system/system.routes.js'))
app.register(require('./modules/operators/operators.routes.js'))
app.register(require('./modules/audits/audits.routes.js'))
app.register(require('./modules/imports/imports.routes.js'))
app.register(require('./modules/exports/exports.routes.js'))
app.register(require('./modules/auth/auth.routes.js'), { stateCache, sign })
app.register(require('./modules/auth/auth.external.routes.js'), { stateCache, sign })
app.register(require('./modules/geometry/geometry.routes.js'))

module.exports = app
