'use strict'

const config = require('./lib/config.js')
config.validate({ allowed: 'strict' })

const app = require('fastify')({ logger: config.get('env') !== 'test' })
const fastifySwagger = require('@fastify/swagger')
const fastifySwaggerUi = require('@fastify/swagger-ui')
const fastifyCors = require('@fastify/cors')
const fastifyMultipart = require('@fastify/multipart')
const fastifyFormBody = require('@fastify/formbody')
const fastifyOauth = require('@fastify/oauth2')
const LRUCache = require('mnemonist/lru-map-with-delete')
const { randomUUID } = require('node:crypto')

const Sentry = require('@sentry/node')
const { ExtraErrorData } = require('@sentry/integrations')
const { createSigner } = require('fast-jwt')
const { all: deepmerge } = require('deepmerge')

const { fetchOperatorById, fetchCustomersByOperator, getUserProfileById, getUserProfileFromSSOToken, operatorLookup, verifyNotificationAuthorization } = require('./lib/providers/agence-bio.js')
const { addNewOperatorParcel, fetchLatestCustomersByControlBody, getOperator, deleteRecord, pacageLookup, updateAuditRecordState, updateOperatorParcels } = require('./lib/providers/cartobio.js')
const { parseShapefileArchive } = require('./lib/providers/telepac.js')
const { parseGeofoliaArchive } = require('./lib/providers/geofolia.js')
const { getMesParcellesOperator } = require('./lib/providers/mes-parcelles.js')

const { swaggerConfig } = require('./lib/routes/index.js')
const { sandboxSchema, ocSchema, internalSchema, hiddenSchema, protectedWithTokenRoute } = require('./lib/routes/index.js')
const { protectedRouteOptions, trackableRoute, enforceSameCertificationBody } = require('./lib/routes/index.js')
const { routeWithOperatorId, routeWithRecordId, routeWithPacage } = require('./lib/routes/index.js')
const { tryLoginSchema } = require('./lib/routes/login.js')

// Application is hosted on localhost:8000 by default
const reportErrors = config.get('reportErrors')

const DURATION_ONE_MINUTE = 1000 * 60
const DURATION_ONE_HOUR = DURATION_ONE_MINUTE * 60
const DURATION_ONE_DAY = DURATION_ONE_HOUR * 24

const db = require('./lib/db.js')
const { FastifyErrorHandler, UnauthorizedApiError } = require('./lib/errors.js')
const sign = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_DAY * 30 })

// Sentry error reporting setup
if (reportErrors) {
  const sentryOptions = {
    dsn: config.get('sentry.dsn'),
    environment: config.get('environment'),
    includeLocalVariables: true,
    integrations: [
      new ExtraErrorData()
    ],
    tracesSampleRate: config.get('environment') === 'production' ? 0.2 : 1
  }

  if (config.get('environment') === 'production') {
    sentryOptions.release = config.get('version')
  } else if (config.get('environment') === 'staging') {
    sentryOptions.release = process.env.SENTRY_RELEASE
  }

  Sentry.init(sentryOptions)
}

app.setErrorHandler(new FastifyErrorHandler({
  sentryClient: Sentry
}))

// Configure server
app.register(fastifyCors, {
  origin: true,
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Accept-Encoding', 'Authorization']
})

// Accept incoming files and forms (GeoJSON, ZIP files, etc.)
app.register(fastifyMultipart)
app.register(fastifyFormBody)

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
  checkStateFunction (state, next) {
    if (stateCache.has(state)) {
      return next()
    }
    next(new Error('Invalid state'))
  }
})

// Routes to protect with a JSON Web Token
app.decorateRequest('decodedToken', null)

app.register(async (app) => {
  // Begin Public API routes
  app.get('/api/version', deepmerge([sandboxSchema, trackableRoute]), (request, reply) => {
    return reply.send({ version: config.get('version') })
  })

  app.get('/api/v2/test', deepmerge([sandboxSchema, protectedRouteOptions]), (request, reply) => {
    return reply.send({ message: 'OK' })
  })

  /**
   * @private
   */
  app.post('/api/v2/tryLogin', deepmerge([internalSchema, tryLoginSchema]), (request, reply) => {
    const { q } = request.body
    const sign = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_MINUTE * 8 })

    return operatorLookup({ q })
      .then(operators => operators.map(operator => ({
        ...operator,
        // @todo remove this when we move to SSO login
        // token is valid for 8 minutes
        // wich means a user has 8 minutes to search, and click on "identify as…" button
        temporaryLoginToken: sign(operator)
      })))
      .then(userProfiles => reply.code(200).send(userProfiles))
  })

  /**
   * @private
   */
  app.post('/api/v2/temporaryLoginWithToken', deepmerge([internalSchema, protectedRouteOptions]), (request, reply) => {
    const { decodedToken } = request

    delete decodedToken.exp

    return reply.code(200).send(sign(decodedToken))
  })

  app.get('/api/v2/stats', internalSchema, (request, reply) => {
    return db.query("SELECT COUNT(parcelles) as count, SUM(JSONB_ARRAY_LENGTH(parcelles->'features')::bigint) as parcelles_count FROM cartobio_operators WHERE metadata->>'source' != '';")
      .then(({ rows }) => reply.code(200).send({ stats: rows[0] }))
  })

  /**
   * @private
   * @TODO control and derive ocId credentials
   */
  app.post('/api/v2/certification/operators/search', deepmerge([internalSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { input: nom } = request.body
    const { id: ocId } = request.decodedToken.organismeCertificateur

    return fetchCustomersByOperator({ ocId, nom })
      .then(operators => reply.code(200).send({ operators }))
  })

  app.patch('/api/v2/certification/audits/:recordId', deepmerge([internalSchema, routeWithRecordId, protectedRouteOptions, ocSchema, trackableRoute]), (request, reply) => {
    const { ...patch } = request.body
    const { recordId } = request.params

    return updateAuditRecordState(recordId, patch)
      .then(record => reply.code(200).send(record))
  })

  /**
   * @private
   * @TODO control and derive ocId credentials
   */
  app.get('/api/v2/certification/operators/latest', deepmerge([internalSchema, protectedRouteOptions]), (request, reply) => {
    const { id: ocId } = request.decodedToken.organismeCertificateur

    return fetchLatestCustomersByControlBody({ ocId })
      .then(operators => reply.code(200).send({ operators }))
  })

  /**
   * @private
   */
  app.get('/api/v2/operator/:operatorId', deepmerge([internalSchema, routeWithOperatorId, enforceSameCertificationBody, ocSchema, trackableRoute, protectedRouteOptions]), (request, reply) => {
    const { operatorId } = request.params

    return getOperator({ operatorId })
      .then(result => reply.code(200).send(result))
  })

  /**
   * @private
   */
  app.put('/api/v2/operator/:operatorId/parcelles', deepmerge([internalSchema, routeWithOperatorId, ocSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { body } = request
    const { operatorId } = request.params
    const { id: ocId, nom: ocLabel } = request.decodedToken.organismeCertificateur

    return updateOperatorParcels({ operatorId }, { ...body, ocId, ocLabel })
      .then(result => reply.code(200).send(result))
  })

  app.post('/api/v2/operator/:operatorId/parcelles', deepmerge([internalSchema, routeWithOperatorId, ocSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { feature } = request.body
    const { operatorId } = request.params

    return addNewOperatorParcel({ operatorId }, feature)
      .then(result => reply.code(200).send(result))
  })

  /**
   * @private
   */
  app.delete('/api/v2/operator/:operatorId', deepmerge([internalSchema, routeWithOperatorId, ocSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { operatorId } = request.params

    return deleteRecord({ operatorId })
      .then(() => reply.code(200).send())
  })

  /**
   * @private
   */
  app.post('/api/v2/convert/shapefile/geojson', deepmerge([protectedRouteOptions, internalSchema]), async (request, reply) => {
    return parseShapefileArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  /**
   * @private
   */
  app.post('/api/v2/convert/geofolia/geojson', deepmerge([protectedRouteOptions, internalSchema]), async (request, reply) => {
    return parseGeofoliaArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  app.get('/api/v2/import/pacage/:numeroPacage', deepmerge([internalSchema, ocSchema, protectedRouteOptions, routeWithPacage]), async (request, reply) => {
    const { numeroPacage } = request.params

    return pacageLookup({ numeroPacage })
      .then(featureCollection => reply.send(featureCollection))
  })

  app.post('/api/webhooks/mattermost', deepmerge([internalSchema, protectedWithTokenRoute]), async (request, reply) => {
    const { user_name: userName, command } = request.body

    request.log.info('Incoming mattermost command (%s)', command)

    reply.send({
      response_type: 'ephemeral',
      text: `Coucou ${userName} :wave_light_skin_tone:`
    })
  })

  /**
   * @private
   */
  app.post('/api/v2/import/mesparcelles/login', deepmerge([hiddenSchema, internalSchema]), async (request, reply) => {
    const { email, millesime, password, server } = request.body

    const geojson = await getMesParcellesOperator({ email, millesime, password, server })
    reply.send(geojson)
  })

  app.get('/api/v2/user/verify', deepmerge([sandboxSchema, internalSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { decodedToken } = request

    return reply.send(decodedToken)
  })

  app.get('/api/v2/user/exchangeToken', deepmerge([sandboxSchema, internalSchema, protectedRouteOptions]), async (request, reply) => {
    const { error, payload: decodedToken, token } = verifyNotificationAuthorization(request.headers.authorization)

    if (error) {
      return new UnauthorizedApiError('Unable to verify the provided token', error)
    }

    const [operator, userProfile] = await Promise.all([
      fetchOperatorById(decodedToken.operateurId),
      getUserProfileById(decodedToken.userId, token)
    ])

    const sign = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_HOUR * 2 })

    // dirty hack as long as we don't clearly separate operator/user in the client side authentication
    userProfile.id = operator.id
    userProfile.numeroBio = String(operator.numeroBio)
    userProfile.organismeCertificateur = operator.organismeCertificateur

    return reply.send({
      operator,
      // @todo use Notification pubkey and time based token to passthrough the requests to both Agence Bio and CartoBio APIs
      token: sign(userProfile)
    })
  })

  // usefull only in dev mode
  app.get('/auth-provider/agencebio/login', hiddenSchema, (request, reply) => reply.redirect('/api/auth-provider/agencebio/login'))
  app.get('/api/auth-provider/agencebio/callback', deepmerge([sandboxSchema, hiddenSchema]), async (request, reply) => {
    // forwards to the UI the user-selected tab
    const { mode = '', returnto = '' } = stateCache.get(request.query.state)
    const { token } = await app.agenceBioOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const userProfile = await getUserProfileFromSSOToken(token.access_token)
    const cartobioToken = sign(userProfile)

    return reply.redirect(`${config.get('frontendUrl')}/login?mode=${mode}&returnto=${returnto}#token=${cartobioToken}`)
  })
})

// Expose OpenAPI schema and Swagger documentation
app.register(fastifySwagger, swaggerConfig)

app.register(fastifySwaggerUi, {
  baseDir: '/api',
  routePrefix: '/api/documentation'
})

app.ready().then(() => app.swagger())

if (require.main === module) {
  db.query('SHOW server_version;').then(async ({ rows }) => {
    const { server_version: pgVersion } = rows[0]
    console.log(`Postgres connection established, v${pgVersion}`)

    const address = await app.listen({
      host: config.get('host'),
      port: config.get('port')
    })

    console.log(`Running env:${config.get('env')} on ${address}`)
  }, () => console.error('Failed to connect to database'))
}

module.exports = app
