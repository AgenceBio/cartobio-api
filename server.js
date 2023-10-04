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

const { fetchOperatorById, fetchCustomersByOperator, getUserProfileById, getUserProfileFromSSOToken, operatorLookup, verifyNotificationAuthorization } = require('./lib/providers/agence-bio.js')
const { addRecordFeature, fetchLatestCustomersByControlBody, deleteRecord, pacageLookup, patchFeatureCollection, updateAuditRecordState, updateFeatureProperties, getParcellesStats, getDataGouvStats, createOrReplaceOperatorRecord, parcellaireStreamToDb, deleteSingleFeature } = require('./lib/providers/cartobio.js')
const { parseShapefileArchive } = require('./lib/providers/telepac.js')
const { parseGeofoliaArchive } = require('./lib/providers/geofolia.js')
const { getMesParcellesOperator } = require('./lib/providers/mes-parcelles.js')

const { deepmerge, commonSchema, swaggerConfig } = require('./lib/routes/index.js')
const { sandboxSchema, internalSchema, hiddenSchema } = require('./lib/routes/index.js')
const { protectedWithToken, enforceSameCertificationBody } = require('./lib/routes/index.js')
const { routeWithNumeroBio, routeWithOperatorId, routeWithRecordId, routeWithPacage } = require('./lib/routes/index.js')
const { tryLoginSchema } = require('./lib/routes/login.js')
const { createFeatureSchema, createRecordSchema, deleteSingleFeatureSchema, patchFeatureCollectionSchema, patchRecordSchema, updateFeaturePropertiesSchema } = require('./lib/routes/records.js')
const { postCertificationParcellesSchema, respondWithFeatureCollectionSchema } = require('./lib/routes/features.js')

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
app.decorateRequest('decodedToken', null)
app.decorateRequest('organismeCertificateur', null)

// Requests can be decorated by a given Record too (associated to an operatorId/recordId)
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
  app.get('/api/version', deepmerge(sandboxSchema), (_, reply) => {
    return reply.send({ version: config.get('version') })
  })

  app.get('/api/v2/test', deepmerge(sandboxSchema, protectedWithToken({ oc: true, cartobio: true })), (_, reply) => {
    return reply.send({ message: 'OK' })
  })

  /**
   * @private
   */
  app.post('/api/v2/tryLogin', deepmerge(hiddenSchema, tryLoginSchema), (request, reply) => {
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
  app.post('/api/v2/temporaryLoginWithToken', deepmerge(protectedWithToken(), hiddenSchema), (request, reply) => {
    const { decodedToken } = request

    delete decodedToken.exp

    return reply.code(200).send(sign(decodedToken))
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
    const { input: nom } = request.body
    const { id: ocId } = request.decodedToken.organismeCertificateur

    return fetchCustomersByOperator({ ocId, nom })
      .then(operators => reply.code(200).send({ operators }))
  })

  /**
   * @private
   * @TODO control and derive ocId credentials
   */
  app.get('/api/v2/certification/operators/latest', deepmerge(protectedWithToken()), (request, reply) => {
    const { id: ocId } = request.decodedToken.organismeCertificateur

    return fetchLatestCustomersByControlBody({ ocId })
      .then(operators => reply.code(200).send({ operators }))
  })

  /**
   * Retrieve the latest Record for a given operator
   */
  app.get('/api/v2/operator/:operatorId', deepmerge(protectedWithToken(), routeWithOperatorId, enforceSameCertificationBody), (request, reply) => {
    return reply.code(200).send(request.record)
  })

  /**
   * Retrieve the latest FeatureCollection for a given operator
   */
  app.get('/api/v2/operateurs/:numeroBio/parcelles', deepmerge(protectedWithToken({ oc: true, cartobio: true }), routeWithNumeroBio, enforceSameCertificationBody, respondWithFeatureCollectionSchema), (request, reply) => {
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
   * TODO address the mandatory
   */
  app.post('/api/v2/audits/:operatorId', deepmerge(
    createRecordSchema,
    routeWithOperatorId,
    enforceSameCertificationBody,
    protectedWithToken()
  ), async (request, reply) => {
    const { operatorId } = request.params
    const { id: ocId, nom: ocLabel } = request.decodedToken.organismeCertificateur

    const record = await createOrReplaceOperatorRecord(
      operatorId,
      { ...request.body, ocId, ocLabel },
      { decodedToken: request.decodedToken, oldRecord: request.record }
    )
    return reply.code(200).send(record)
  })

  /**
   * Partial update Record's metadata (top-level properties except features)
   * It also keep track of new HistoryEvent along the way, depending who and when you update feature properties
   */
  app.patch('/api/v2/audits/:recordId', deepmerge(protectedWithToken(), patchRecordSchema, routeWithRecordId), (request, reply) => {
    const { body: patch, decodedToken, record } = request

    return updateAuditRecordState({ decodedToken, record }, patch)
      .then(record => reply.code(200).send(record))
  })

  /**
   * Delete a Record
   * TODO: do not hard delete but purge features while keeping its history
   */
  app.delete('/api/v2/audits/:recordId', deepmerge(protectedWithToken(), routeWithRecordId), (request, reply) => {
    const { decodedToken, record } = request

    return deleteRecord({ decodedToken, record })
      .then(result => reply.code(200).send(result))
  })

  /**
   * Add new feature entries to an existing collection
   */
  app.post('/api/v2/audits/:recordId/parcelles', deepmerge(protectedWithToken(), createFeatureSchema, routeWithRecordId), (request, reply) => {
    const { feature } = request.body
    const { decodedToken, record } = request

    return addRecordFeature({ decodedToken, record }, feature)
      .then(result => reply.code(200).send(result))
  })

  /**
   * Partial update a feature collection (ie: mass action from the collection screen)
   *
   * It's non-destructive — matching ids are updated, new ids are added, non-existent ids are kept as is
   */
  app.patch('/api/v2/audits/:recordId/parcelles', deepmerge(protectedWithToken(), patchFeatureCollectionSchema, routeWithRecordId), (request, reply) => {
    const { body: featureCollection, decodedToken, record } = request

    return patchFeatureCollection({ decodedToken, record }, featureCollection.features)
      .then(record => reply.code(200).send(record))
  })

  /**
   * Full update a single feature (ie: feature form from an editing modal)
   *
   * It's destructive — non-matching ids are removed (ie: crops)
   */
  app.put('/api/v2/audits/:recordId/parcelles/:featureId', deepmerge(protectedWithToken(), updateFeaturePropertiesSchema, routeWithRecordId), (request, reply) => {
    const { body: feature, decodedToken, record } = request
    const { featureId } = request.params

    return updateFeatureProperties({ featureId, decodedToken, record }, feature)
      .then(record => reply.code(200).send(record))
  })

  /**
   * Delete a single feature
   */
  app.delete('/api/v2/audits/:recordId/parcelles/:featureId', deepmerge(protectedWithToken(), deleteSingleFeatureSchema, routeWithRecordId), (request, reply) => {
    const { decodedToken, record } = request
    const { reason } = request.body
    const { featureId } = request.params

    return deleteSingleFeature({ featureId, decodedToken, record }, { reason })
      .then(record => reply.code(200).send(record))
  })

  /**
   * Turn a shapefile into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post('/api/v2/convert/shapefile/geojson', deepmerge(protectedWithToken({ oc: true, cartobio: true }), respondWithFeatureCollectionSchema), async (request, reply) => {
    return parseShapefileArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  /**
   * Turn a Geofolia file into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post('/api/v2/convert/geofolia/geojson', deepmerge(protectedWithToken(), respondWithFeatureCollectionSchema), async (request, reply) => {
    return parseGeofoliaArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  /**
   * Retrieves all features associated to a PACAGE as a workeable FeatureCollection
   */
  app.get('/api/v2/import/pacage/:numeroPacage', deepmerge(protectedWithToken({ cartobio: true, oc: true }), routeWithPacage, respondWithFeatureCollectionSchema), async (request, reply) => {
    const { numeroPacage } = request.params

    return pacageLookup({ numeroPacage })
      .then(featureCollection => reply.send(featureCollection))
  })

  app.post('/api/v2/certification/parcelles', deepmerge(protectedWithToken({ oc: true }), postCertificationParcellesSchema, {
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

  app.post('/api/webhooks/mattermost', deepmerge(protectedWithToken({ mattermost: true }), internalSchema), async (request, reply) => {
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
  app.post('/api/v2/import/mesparcelles/login', deepmerge(hiddenSchema, internalSchema), async (request, reply) => {
    const { email, millesime, password, server } = request.body

    const geojson = await getMesParcellesOperator({ email, millesime, password, server })
    reply.send(geojson)
  })

  app.get('/api/v2/user/verify', deepmerge(protectedWithToken({ oc: true, cartobio: true }), sandboxSchema, internalSchema), (request, reply) => {
    const { decodedToken, organismeCertificateur } = request

    return reply.send(decodedToken ?? organismeCertificateur)
  })

  /**
   * Exchange a notification.agencebio.org token for a CartoBio token
   */
  app.get('/api/v2/user/exchangeToken', deepmerge(protectedWithToken(), internalSchema), async (request, reply) => {
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
