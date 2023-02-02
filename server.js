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

const parcelsFixture = require('./test/fixtures/parcels.json')
const summaryFixture = require('./test/fixtures/summary.json')
const { featureCollection } = require('@turf/helpers')

const { getOperatorParcels, getOperatorSummary } = require('./lib/parcels.js')
const { fetchAuthToken, fetchUserProfile, getUserProfileFromSSOToken, operatorLookup, fetchCustomersByOperator, getCertificationBodyForPacage } = require('./lib/providers/agence-bio.js')
const { updateOperator, updateOperatorParcels, getOperator, updateAuditRecordState, fetchLatestCustomersByControlBody, pacageLookup } = require('./lib/providers/cartobio.js')
const { parseShapefileArchive } = require('./lib/providers/telepac.js')
const { parseGeofoliaArchive } = require('./lib/providers/geofolia.js')
const { getMesParcellesOperator } = require('./lib/providers/mes-parcelles.js')

const { swaggerConfig } = require('./lib/routes/index.js')
const { sandboxSchema, deprecatedSchema, ocSchema, internalSchema, hiddenSchema, protectedWithTokenRoute } = require('./lib/routes/index.js')
const { notificationRouteOptions, protectedRouteOptions, trackableRoute, enforceSameCertificationBody } = require('./lib/routes/index.js')
const { routeWithOperatorId, routeWithRecordId, routeWithNumeroBio, routeWithPacage } = require('./lib/routes/index.js')
const { loginSchema, tryLoginSchema } = require('./lib/routes/login.js')
const { operatorSchema } = require('./lib/routes/operators.js')

// Application is hosted on localhost:8000 by default
const reportErrors = config.get('reportErrors')

const db = require('./lib/db.js')
const { ApiError, FastifyErrorHandler, InvalidRequestApiError } = require('./lib/errors.js')
const sign = createSigner({ key: config.get('jwtSecret') })

// Sentry error reporting setup
if (reportErrors) {
  Sentry.init({
    dsn: config.get('sentry.dsn'),
    environment: config.get('environment'),
    includeLocalVariables: true,
    integrations: [
      new ExtraErrorData()
    ],
    release: 'cartobio-api@' + config.get('version'),
    tracesSampleRate: config.get('environment') === 'production' ? 0.2 : 1
  })
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

// Expose OpenAPI schema and Swagger documentation
app.register(fastifySwagger, swaggerConfig)

app.register(fastifySwaggerUi, {
  baseDir: '/api',
  routePrefix: '/api/documentation'
})

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
  generateStateFunction () {
    const state = randomUUID()
    stateCache.set(state, true)
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

  app.get('/api/v1/version', deepmerge([sandboxSchema, deprecatedSchema]), (request, reply) => reply.code(301).redirect('/api/version'))

  app.get('/api/v1/test', deepmerge([sandboxSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    return reply.send({ test: 'OK' })
  })

  app.get('/api/v1/summary', deepmerge([hiddenSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { decodedToken } = request
    const { test: isTest, ocId } = decodedToken

    if (isTest === true) {
      return reply.code(200).send(summaryFixture)
    }

    return getOperatorSummary({ ocId })
      .then(geojson => reply.code(200).send(geojson))
      .catch(error => new ApiError(`Failed to return summary for OC ${ocId}`, error))
  })

  app.get('/api/v1/parcels', deepmerge([hiddenSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { decodedToken } = request
    const { ocId } = decodedToken

    if (config.get('env') === 'test') {
      return reply.code(200).send(parcelsFixture)
    }

    return getOperatorParcels({ ocId })
      .then(geojson => reply.code(200).send(geojson))
      .catch(error => new ApiError(`Failed to return parcels for OC ${ocId}`, error))
  })

  app.get('/api/v1/parcels/operator/:numeroBio', deepmerge([hiddenSchema, protectedRouteOptions, routeWithNumeroBio, trackableRoute]), (request, reply) => {
    const { decodedToken, params } = request
    const { ocId } = decodedToken
    const { numeroBio } = params

    if (config.get('env') === 'test') {
      return reply.code(200).send(
        featureCollection(parcelsFixture.features.filter(({ properties }) => properties.numerobio === Number(numeroBio)))
      )
    }

    return getOperatorParcels({ ocId, numeroBio })
      .then(geojson => reply.code(200).send(geojson))
      .catch(error => new ApiError(`Failed to return parcels for OC ${ocId}`, error))
  })

  /**
   * @private
   */
  app.post('/api/v1/login', deepmerge([internalSchema, loginSchema]), (request, reply) => {
    const { email, password: motDePasse } = request.body

    const auth = fetchAuthToken({ email, motDePasse })

    auth.catch(({ message: error }) => new InvalidRequestApiError(401, 'Invalid email/password', error))

    return auth
      .then(token => fetchUserProfile(token))
      .then(({ userProfile, token }) => {
        return reply.code(200).send({
          // to maintain backwards compat with direct calls to Agence Bio API
          agencebio: token,
          // to use user data straight from CartoBio-Presentation
          // without additional API calls
          cartobio: sign({
            ...userProfile,
            userId: userProfile.id,
            ocId: userProfile.organismeCertificateurId,
            organismeCertificateur: userProfile.organismeCertificateur || {}
            // for now we will bind the token to the AgenceBio expiry
            //  iat: Math.floor(Date.now() / 1000)
            // }, config.get('jwtSecret'), { expiresIn: '14d' })
          }, config.get('jwtSecret'))
        })
      }, error => new InvalidRequestApiError(401, 'Failed to authenticate user', error))
  })

  /**
   * @private
   */
  app.post('/api/v1/tryLogin', deepmerge([internalSchema, tryLoginSchema]), (request, reply) => {
    const { q } = request.body

    return operatorLookup({ q })
      .then(userProfiles => reply.code(200).send(userProfiles))
      .catch(error => new ApiError(`Failed to login with ${q}`, error))
  })
  /**
   * @todo lookup for PACAGE stored in the `cartobio_operators` table
   * @private
   */
  app.get('/api/v1/pacage/:numeroPacage', deepmerge([internalSchema, protectedRouteOptions, routeWithPacage]), (request, reply) => {
    const { numeroPacage } = request.params

    return getCertificationBodyForPacage({ numeroPacage })
      .then(({ ocId, numeroBio } = {}) => {
        return reply.code(200).send({ numeroPacage, numeroBio, ocId })
      })
      .catch(error => new ApiError(`Failed to fetch ocId for ${numeroPacage}`, error))
  })

  /**
   * @private
   */
  app.patch('/api/v1/operator/:numeroBio', deepmerge([internalSchema, routeWithNumeroBio, protectedRouteOptions, operatorSchema, trackableRoute]), (request, reply) => {
    const { decodedToken, body } = request
    const { ocId } = decodedToken
    const { numeroBio } = request.params

    return updateOperator({ numeroBio, ocId }, body)
      .then(() => getOperatorSummary({ numeroBio, ocId }))
      .then(geojson => reply.code(200).send(geojson))
      .catch(error => new ApiError(`Failed to update operator ${numeroBio} for OC ${ocId}`, error))
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
    const { organismeCertificateurId: ocId } = request.decodedToken

    return fetchCustomersByOperator({ ocId, nom })
      .then(operators => reply.code(200).send({ operators }))
      .catch(error => new ApiError(`Failed to fetch operators for ${ocId}`, error))
  })

  app.patch('/api/v2/certification/audits/:recordId', deepmerge([internalSchema, routeWithRecordId, protectedRouteOptions, ocSchema, trackableRoute]), (request, reply) => {
    const { ...patch } = request.body
    const { recordId } = request.params

    return updateAuditRecordState(recordId, patch)
      .then(record => reply.code(200).send(record))
      .catch(error => new ApiError(`Failed to update audit state for record ${recordId}`, error))
  })

  /**
   * @private
   * @TODO control and derive ocId credentials
   */
  app.get('/api/v2/certification/operators/latest', deepmerge([internalSchema, protectedRouteOptions]), (request, reply) => {
    const { organismeCertificateurId: ocId } = request.decodedToken

    return fetchLatestCustomersByControlBody({ ocId })
      .then(operators => reply.code(200).send({ operators }))
      .catch(error => new ApiError(`Failed to fetch operators for ${ocId}`, error))
  })

  /**
   * @private
   */
  app.get('/api/v2/operator/:operatorId', deepmerge([internalSchema, routeWithOperatorId, enforceSameCertificationBody, ocSchema, trackableRoute/*, protectedRouteOptions */]), (request, reply) => {
    const { operatorId } = request.params

    return getOperator({ operatorId })
      .then(result => reply.code(200).send(result))
      .catch(error => new ApiError(`Failed to fetch operator #${operatorId}`, error))
  })

  /**
   * @private
   */
  app.post('/api/v2/operator/:operatorId/parcelles', deepmerge([internalSchema, routeWithOperatorId, ocSchema, trackableRoute]), (request, reply) => {
    const { body } = request
    const { operatorId } = request.params

    return updateOperatorParcels({ operatorId }, body)
      .then(result => reply.code(200).send(result))
      .catch(error => new ApiError(`Failed to update operator ${operatorId} parcels`, error))
  })

  /**
   * @private
   */
  app.post('/api/v1/convert/shapefile/geojson', deepmerge([hiddenSchema, internalSchema]), async (request, reply) => {
    return parseShapefileArchive(request.file())
      .then(geojson => reply.send(geojson))
      .catch(error => new ApiError('Failed to parse Shapefile archive', error))
  })

  /**
   * @private
   */
  app.post('/api/v1/convert/geofolia/geojson', deepmerge([hiddenSchema, internalSchema]), async (request, reply) => {
    return parseGeofoliaArchive(request.file())
      .then(geojson => reply.send(geojson))
      .catch(error => new ApiError('Failed to parse Geofolia archive', error))
  })

  app.get('/api/v2/import/pacage/:numeroPacage', deepmerge([internalSchema, ocSchema, protectedRouteOptions, routeWithPacage]), async (request, reply) => {
    const { numeroPacage } = request.params

    return pacageLookup({ numeroPacage })
      .then(featureCollection => reply.send(featureCollection))
      .catch(error => new ApiError(`Failed to retrieve PACAGE #${numeroPacage} features`, error))
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
    const { email, password, server } = request.body

    return getMesParcellesOperator({ email, password, server })
      .then(geojson => reply.send(geojson))
      .catch(error => new ApiError('Failed to import MesParcelles features', error))
  })

  app.get('/api/v2/user/verify', deepmerge([sandboxSchema, internalSchema, protectedRouteOptions, trackableRoute]), (request, reply) => {
    const { decodedToken } = request

    return reply.send(decodedToken)
  })

  app.get('/api/v2/user/exchangeToken', deepmerge([sandboxSchema, internalSchema, notificationRouteOptions, trackableRoute]), async (request, reply) => {
    const { notificationToken } = request
    const token = request.headers.authorization.replace('Bearer ', '')

    console.log({ notificationToken, token })

    const userProfile = await getUserProfileFromSSOToken(token)

    console.log({ userProfile })

    return reply.send({ userProfile })
  })

  // usefull only in dev mode
  app.get('/auth-provider/agencebio/login', hiddenSchema, (request, reply) => reply.redirect('/api/auth-provider/agencebio/login'))
  app.get('/api/auth-provider/agencebio/callback', deepmerge([sandboxSchema, hiddenSchema]), async (request, reply) => {
    const { token } = await app.agenceBioOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const userProfile = await getUserProfileFromSSOToken(token.access_token)
    const cartobioToken = sign(userProfile, config.get('jwtSecret'), { expiresIn: '30d' })

    return reply.redirect(`${config.get('frontendUrl')}/login#token=${cartobioToken}`)
  })
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
