'use strict'

const config = require('./lib/config.js')
config.validate({ allowed: 'strict' })

const app = require('fastify')({
  logger: config.get('env') !== 'test',
  ajv: {
    plugins: [require('ajv-formats')]
  }
})

const fastifySwagger = require('@fastify/swagger')
const fastifySwaggerUi = require('@fastify/swagger-ui')
const fastifyCors = require('@fastify/cors')
const fastifyMultipart = require('@fastify/multipart')
const fastifyFormBody = require('@fastify/formbody')
const fastifyOauth = require('@fastify/oauth2')
const stripBom = require('strip-bom-stream')
const LRUCache = require('mnemonist/lru-map-with-delete')
const { randomUUID } = require('node:crypto')
const { PassThrough } = require('stream')

const Sentry = require('@sentry/node')
const { ExtraErrorData } = require('@sentry/integrations')
const { createSigner } = require('fast-jwt')

const { fetchOperatorByNumeroBio, fetchCustomersByOc, getUserProfileById, getUserProfileFromSSOToken, verifyNotificationAuthorization, fetchUserOperators } = require('./lib/providers/agence-bio.js')
const { addRecordFeature, fetchLatestCustomersByControlBody, deleteRecord, pacageLookup, patchFeatureCollection, updateAuditRecordState, updateFeature, getParcellesStats, getDataGouvStats, createOrUpdateOperatorRecord, parcellaireStreamToDb, deleteSingleFeature } = require('./lib/providers/cartobio.js')
const { parseShapefileArchive } = require('./lib/providers/telepac.js')
const { parseGeofoliaArchive } = require('./lib/providers/geofolia.js')

const { deepmerge, commonSchema, swaggerConfig } = require('./lib/routes/index.js')
const { sandboxSchema, internalSchema, hiddenSchema } = require('./lib/routes/index.js')
const { protectedWithToken, enforceSameCertificationBody } = require('./lib/routes/index.js')
const { routeWithNumeroBio, routeWithRecordId, routeWithPacage } = require('./lib/routes/index.js')
const { createFeatureSchema, createRecordSchema, deleteSingleFeatureSchema, patchFeatureCollectionSchema, patchRecordSchema, updateFeaturePropertiesSchema } = require('./lib/routes/records.js')

// Application is hosted on localhost:8000 by default
const reportErrors = config.get('reportErrors')

const DURATION_ONE_MINUTE = 1000 * 60
const DURATION_ONE_HOUR = DURATION_ONE_MINUTE * 60
const DURATION_ONE_DAY = DURATION_ONE_HOUR * 24

const db = require('./lib/db.js')
const { FastifyErrorHandler, UnauthorizedApiError } = require('./lib/errors.js')
const { normalizeRecord } = require('./lib/outputs/record')
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
  } else if (config.get('environment') === 'staging' || config.get('environment') === 'test') {
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
  checkStateFunction ({ query }, next) {
    if (stateCache.has(query.state)) {
      return next()
    }
    next(new Error('Invalid state'))
  }
})

// Routes to protect with a JSON Web Token
app.decorateRequest('user', null)
app.decorateRequest('organismeCertificateur', null)

// Requests can be decorated by a given Record too (associated to a numeroBio/recordId)
app.decorateRequest('record', null)

// Requests can be decorated by an API result when we do custom stream parsing
app.decorateRequest('APIResult', null)

app.addSchema(commonSchema)

// Expose OpenAPI schema and Swagger documentation
app.register(fastifySwagger, swaggerConfig)

app.register(fastifySwaggerUi, {
  baseDir: '/api',
  routePrefix: '/api/documentation'
})

app.register(async (app) => {
  // Begin Public API routes
  app.get('/api/version', sandboxSchema, (_, reply) => {
    return reply.send({ version: config.get('version') })
  })

  app.get('/api/v2/test', deepmerge(sandboxSchema, protectedWithToken({ oc: true, cartobio: true })), (_, reply) => {
    return reply.send({ message: 'OK' })
  })

  app.get('/api/v2/stats', internalSchema, async (request, reply) => {
    const [dataGouv, stats] = await Promise.all([
      getDataGouvStats(),
      getParcellesStats()
    ])

    return reply.code(200).send({ stats, dataGouv })
  })

  /**
   * @private
   */
  app.post('/api/v2/certification/operators/search', deepmerge(protectedWithToken()), (request, reply) => {
    const input = request.body.input?.trim()
    const { id: ocId } = request.user.organismeCertificateur

    const [nom, numeroBio] = /^\d+$/.test(input) ? ['', input] : [input, '']

    return fetchCustomersByOc({ ocId, nom, numeroBio })
      .then(operators => reply.code(200).send({ operators }))
  })

  /**
   * @private
   * @TODO control and derive ocId credentials
   */
  app.get('/api/v2/certification/operators/latest', deepmerge(protectedWithToken()), (request, reply) => {
    const { id: ocId } = request.user.organismeCertificateur

    return fetchLatestCustomersByControlBody({ ocId })
      .then(operators => reply.code(200).send({ operators }))
  })

  /**
   * @private
   * Retrieve a given operators for a given user
   */
  app.get('/api/v2/operators', deepmerge(protectedWithToken({ cartobio: true })), (request, reply) => {
    const { id: userId } = request.user

    return fetchUserOperators(userId)
      .then(operators => reply.code(200).send({ operators }))
  })

  /**
   * Retrieve the latest Record for a given operator
   */
  app.get('/api/v2/operator/:numeroBio', deepmerge(protectedWithToken(), routeWithNumeroBio, enforceSameCertificationBody), (request, reply) => {
    return reply.code(200).send(request.record)
  })

  /**
   * Retrieve the latest FeatureCollection for a given operator
   */
  app.get('/api/v2/operateurs/:numeroBio/parcelles', deepmerge(protectedWithToken({ oc: true, cartobio: true }), routeWithNumeroBio, enforceSameCertificationBody), (request, reply) => {
    return reply.code(200).send(request.record.parcelles)
  })

  /**
   * Retrieve a given Record
   */
  app.get('/api/v2/audits/:recordId', deepmerge(routeWithRecordId, enforceSameCertificationBody, protectedWithToken()), (request, reply) => {
    return reply.code(200).send(request.record)
  })

  /**
   * Create a new Record for a given Operator
   */
  app.post('/api/v2/audits/:numeroBio', deepmerge(
    createRecordSchema,
    routeWithNumeroBio,
    enforceSameCertificationBody,
    protectedWithToken()
  ), async (request, reply) => {
    const { numeroBio } = request.params
    const { id: ocId, nom: ocLabel } = request.record.operator.organismeCertificateur

    const record = await createOrUpdateOperatorRecord(
      { numeroBio, ocId, ocLabel, ...request.body },
      { user: request.user, oldRecord: request.record }
    )
    return reply.code(200).send(normalizeRecord({ record, operator: request.record.operator }))
  })

  /**
   * Partial update Record's metadata (top-level properties except features)
   * It also keep track of new HistoryEvent along the way, depending who and when you update feature properties
   */
  app.patch('/api/v2/audits/:recordId', deepmerge(protectedWithToken(), patchRecordSchema, routeWithRecordId), (request, reply) => {
    const { body: patch, user, record } = request

    return updateAuditRecordState({ user, record }, patch)
      .then(record => reply.code(200).send(record))
  })

  /**
   * Delete a Record
   * TODO: do not hard delete but purge features while keeping its history
   */
  app.delete('/api/v2/audits/:recordId', deepmerge(protectedWithToken(), routeWithRecordId), (request, reply) => {
    const { user, record } = request

    return deleteRecord({ user, record })
      .then(result => reply.code(200).send(result))
  })

  /**
   * Add new feature entries to an existing collection
   */
  app.post('/api/v2/audits/:recordId/parcelles', deepmerge(protectedWithToken(), createFeatureSchema, routeWithRecordId), (request, reply) => {
    const { feature } = request.body
    const { user, record } = request

    return addRecordFeature({ user, record }, feature)
      .then(record => reply.code(200).send(normalizeRecord({ record, operator: request.record.operator })))
  })

  /**
   * Partial update a feature collection (ie: mass action from the collection screen)
   *
   * It's non-destructive — matching ids are updated, new ids are added, non-existent ids are kept as is
   */
  app.patch('/api/v2/audits/:recordId/parcelles', deepmerge(protectedWithToken(), patchFeatureCollectionSchema, routeWithRecordId), (request, reply) => {
    const { body: featureCollection, user, record } = request

    return patchFeatureCollection({ user, record }, featureCollection.features)
      .then(record => reply.code(200).send(normalizeRecord({ record, operator: request.record.operator })))
  })

  /**
   * Full update a single feature (ie: feature form from an editing modal)
   *
   * It's destructive — non-matching ids are removed (ie: crops)
   */
  app.put('/api/v2/audits/:recordId/parcelles/:featureId', deepmerge(protectedWithToken(), updateFeaturePropertiesSchema, routeWithRecordId), (request, reply) => {
    const { body: feature, user, record } = request
    const { featureId } = request.params

    return updateFeature({ featureId, user, record }, feature)
      .then(record => reply.code(200).send(normalizeRecord({ record, operator: request.record.operator })))
  })

  /**
   * Delete a single feature
   */
  app.delete('/api/v2/audits/:recordId/parcelles/:featureId', deepmerge(protectedWithToken(), deleteSingleFeatureSchema, routeWithRecordId), (request, reply) => {
    const { user, record } = request
    const { reason } = request.body
    const { featureId } = request.params

    return deleteSingleFeature({ featureId, user, record }, { reason })
      .then(record => reply.code(200).send(normalizeRecord({ record, operator: request.record.operator })))
  })

  /**
   * Turn a shapefile into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post('/api/v2/convert/shapefile/geojson', deepmerge(protectedWithToken({ oc: true, cartobio: true })), async (request, reply) => {
    return parseShapefileArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  /**
   * Turn a Geofolia file into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post('/api/v2/convert/geofolia/geojson', deepmerge(protectedWithToken()), async (request, reply) => {
    return parseGeofoliaArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  /**
   * Retrieves all features associated to a PACAGE as a workeable FeatureCollection
   */
  app.get('/api/v2/import/pacage/:numeroPacage', deepmerge(protectedWithToken({ cartobio: true, oc: true }), routeWithPacage), async (request, reply) => {
    const { numeroPacage } = request.params

    return pacageLookup({ numeroPacage })
      .then(featureCollection => reply.send(featureCollection))
  })

  app.post('/api/v2/certification/parcelles', deepmerge(protectedWithToken({ oc: true }), {
    preParsing: async (request, reply, payload) => {
      const stream = payload.pipe(stripBom())

      request.APIResult = await parcellaireStreamToDb(stream, request.organismeCertificateur)
      request.headers['content-length'] = '2'
      return new PassThrough().end('{}')
    }
  }), (request, reply) => {
    const { count, errors } = request.APIResult

    if (errors.length > 0) {
      return reply.code(400).send({
        nbObjetTraites: count,
        nbObjetAcceptes: count - errors.length,
        nbObjetRefuses: errors.length,
        listeProblemes: errors.map(([index, message]) => `[#${index}] ${message}`)
      })
    }

    return reply.code(202).send({
      nbObjetTraites: count
    })
  })

  app.get('/api/v2/user/verify', deepmerge(protectedWithToken({ oc: true, cartobio: true }), sandboxSchema, internalSchema), (request, reply) => {
    const { user, organismeCertificateur } = request

    return reply.send(user ?? organismeCertificateur)
  })

  /**
   * Exchange a notification.agencebio.org token for a CartoBio token
   */
  app.get('/api/v2/user/exchangeToken', internalSchema, async (request, reply) => {
    const { error, decodedToken, token } = verifyNotificationAuthorization(request.headers.authorization)

    if (error) {
      return new UnauthorizedApiError('Unable to verify the provided token', error)
    }

    const [operator, userProfile] = await Promise.all([
      fetchOperatorByNumeroBio(decodedToken.numeroBio, token),
      getUserProfileById(decodedToken.userId, token)
    ])

    const sign = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_HOUR * 2 })

    return reply.send({
      operator,
      // @todo use Notification pubkey and time based token to passthrough the requests to both Agence Bio and CartoBio APIs
      token: sign(userProfile)
    })
  })

  // usefull only in dev mode
  app.get('/auth-provider/agencebio/login', hiddenSchema, (request, reply) => reply.redirect('/api/auth-provider/agencebio/login'))
  app.get('/api/auth-provider/agencebio/callback', deepmerge(sandboxSchema, hiddenSchema), async (request, reply) => {
    // forwards to the UI the user-selected tab
    const { mode = '', returnto = '' } = stateCache.get(request.query.state)
    const { token } = await app.agenceBioOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const userProfile = await getUserProfileFromSSOToken(token.access_token)
    const cartobioToken = sign(userProfile)

    return reply.redirect(`${config.get('frontendUrl')}/login?mode=${mode}&returnto=${returnto}#token=${cartobioToken}`)
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
