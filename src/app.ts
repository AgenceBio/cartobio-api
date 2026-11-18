import Fastify, { type FastifyRequest } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { z } from 'zod'
import config from './config/env.js'
import { loggerOptions } from './config/logger.js'
import dbPlugin from './plugins/db.js'
import httpPlugin from './plugins/http.js'
import swaggerPlugin from './plugins/swagger.js'
import requestDecoratorsPlugin from './plugins/request-decorators.js'
import fastifyOauth, { type FastifyOAuth2Options } from '@fastify/oauth2'
import { LRUMapWithDelete as LRUCache } from 'mnemonist'
import { randomUUID } from 'node:crypto'
import { createSigner } from 'fast-jwt'
import { errorHandler } from './shared/errors.js'
import type { AuthStateCache } from './modules/auth/auth.routes.js'
import systemRoutes from './modules/system/system.routes.js'
import operatorsRoutes from './modules/operators/operators.routes.js'
import auditsRoutes from './modules/audits/audits.routes.js'
import importsRoutes from './modules/imports/imports.routes.js'
import exportsRoutes from './modules/exports/exports.routes.js'
import authRoutes from './modules/auth/auth.routes.js'
import authExternalRoutes from './modules/auth/auth.external.routes.js'
import geometryRoutes from './modules/geometry/geometry.routes.js'
import tableauDeBordRoutes from './modules/tableau-de-bord/tableau-de-bord.routes.js'

config.validate({ allowed: 'strict' })

z.config(z.locales.fr())

const app = Fastify(loggerOptions())

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

const DURATION_ONE_DAY = 1000 * 60 * 60 * 24
const sign = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_DAY * 30 })

app.setErrorHandler(errorHandler)

app.register(dbPlugin)
app.register(httpPlugin)

// SSO Agence Bio
const stateCache: AuthStateCache = new LRUCache(50)
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
      authorizationMethod: config.get('notifications.sso.authorizationMethod') as 'header' | 'body'
    }
  },
  startRedirectPath: '/api/auth-provider/agencebio/login',
  callbackUri: config.get('notifications.sso.callbackUri'),
  generateStateFunction: function (request: FastifyRequest<{ Querystring: { mode?: string; returnto?: string } }>) {
    const state = randomUUID()
    stateCache.set(state, {
      mode: request.query?.mode,
      returnto: request.query?.returnto
    })
    return state
  } as FastifyOAuth2Options['generateStateFunction'],
  checkStateFunction: function ({ query }: FastifyRequest<{ Querystring: { state: string } }>, next: (err?: Error) => void): void {
    if (stateCache.has(query.state)) {
      return next()
    }
    next(new Error('Invalid state'))
  } as FastifyOAuth2Options['checkStateFunction'],
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
  startRedirectPath: '/api/login/geofolia',
  callbackUri: config.get('geofolia.oauth.callbackUri')
})

app.register(swaggerPlugin)
app.register(requestDecoratorsPlugin)

app.register(systemRoutes)
app.register(operatorsRoutes)
app.register(auditsRoutes)
app.register(importsRoutes)
app.register(exportsRoutes)
app.register(authRoutes, { stateCache, sign })
app.register(authExternalRoutes, { stateCache, sign })
app.register(geometryRoutes)
app.register(tableauDeBordRoutes, { prefix: '/api/v3/tdb-api' })

export default app
