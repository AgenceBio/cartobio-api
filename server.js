'use strict'

const Sentry = require('@sentry/node')
const config = require('./lib/config.js')
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
  } else if (config.get('environment') === 'staging' || config.get('environment') === 'test') {
    sentryOptions.release = process.env.SENTRY_RELEASE
  }

  Sentry.init(sentryOptions)
}

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
const stream = require('node:stream')
const JSONStream = require('jsonstream-next')

const { createSigner } = require('fast-jwt')

const { fetchOperatorByNumeroBio, getUserProfileById, getUserProfileFromSSOToken, verifyNotificationAuthorization, fetchUserOperators } = require('./lib/providers/agence-bio.js')
const { addRecordFeature, addDividFeature, patchFeatureCollection, updateAuditRecordState, updateFeature, createOrUpdateOperatorRecord, parcellaireStreamToDb, deleteSingleFeature, getRecords, deleteRecord, getOperatorLastRecord, searchControlBodyRecords } = require('./lib/providers/cartobio.js')
const { evvLookup, evvParcellaire, pacageLookup, getParcellesStats, getDataGouvStats, iterateOperatorLastRecords } = require('./lib/providers/cartobio.js')
const { parseAnyGeographicalArchive } = require('./lib/providers/gdal.js')
const { parseTelepacArchive } = require('./lib/providers/telepac.js')
const { parseGeofoliaArchive, geofoliaLookup, geofoliaParcellaire } = require('./lib/providers/geofolia.js')
const { InvalidRequestApiError, NotFoundApiError } = require('./lib/errors.js')

const { mergeSchemas, swaggerConfig, CartoBioDecoratorsPlugin } = require('./lib/routes/index.js')
const { sandboxSchema, internalSchema, hiddenSchema } = require('./lib/routes/index.js')
const { operatorFromNumeroBio, protectedWithToken, routeWithRecordId, routeWithPacage } = require('./lib/routes/index.js')
const { operatorsSchema, certificationBodySearchSchema } = require('./lib/routes/index.js')
const { createFeatureSchema, createRecordSchema, deleteSingleFeatureSchema, patchFeatureCollectionSchema, patchRecordSchema, updateFeaturePropertiesSchema } = require('./lib/routes/records.js')
const { geofoliaImportSchema } = require('./lib/routes/index.js')

const DURATION_ONE_MINUTE = 1000 * 60
const DURATION_ONE_HOUR = DURATION_ONE_MINUTE * 60
const DURATION_ONE_DAY = DURATION_ONE_HOUR * 24

const db = require('./lib/db.js')
const { UnauthorizedApiError, errorHandler } = require('./lib/errors.js')
const { normalizeRecord } = require('./lib/outputs/record')
const { recordToApi } = require('./lib/outputs/api')
const { isHandledError } = require('./lib/errors')
const sign = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_DAY * 30 })

app.setErrorHandler(errorHandler)
if (reportErrors) {
  Sentry.setupFastifyErrorHandler(app)
}

// Configure server
app.register(fastifyCors, {
  origin: true,
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Accept-Encoding', 'Authorization', 'If-Unmodified-Since']
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

// Expose OpenAPI schema and Swagger documentation
app.register(fastifySwagger, swaggerConfig)
app.register(fastifySwaggerUi, {
  routePrefix: '/api/documentation'
})

app.register(CartoBioDecoratorsPlugin)

app.register(async (app) => {
  // Begin Public API routes
  app.get('/api/version', sandboxSchema, (_, reply) => {
    return reply.send({ version: config.get('version') })
  })

  app.get('/api/v2/test', mergeSchemas(sandboxSchema, protectedWithToken({ oc: true, cartobio: true })), (_, reply) => {
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
  app.post('/api/v2/certification/search', mergeSchemas(certificationBodySearchSchema, protectedWithToken()), async (request, reply) => {
    const { input, page, sort, order } = request.body
    const { id: ocId } = request.user.organismeCertificateur

    const { pagination, records } = await searchControlBodyRecords({ ocId, input, page, sort, order })

    return reply.code(200).send({ pagination, records })
  })

  /**
   * @private
   * Retrieve operators for a given user
   */
  app.get('/api/v2/operators', mergeSchemas(protectedWithToken({ cartobio: true }), operatorsSchema), (request, reply) => {
    const { id: userId } = request.user
    const { limit, offset } = request.query

    return fetchUserOperators(userId, limit, offset)
      .then(res => { res.operators = res.operators.filter((e) => e.isProduction === true); return res })
      .then(res => reply.code(200).send(res))
  })

  /**
   * @private
   * Retrieve an operator
   */
  app.get('/api/v2/operator/:numeroBio', mergeSchemas(protectedWithToken(), operatorFromNumeroBio), (request, reply) => {
    return reply.code(200).send(request.operator)
  })

  /**
   * @private
   * Retrieve an operator records
   */
  app.get('/api/v2/operator/:numeroBio/records', mergeSchemas(protectedWithToken(), operatorFromNumeroBio), async (request, reply) => {
    const records = await getRecords(request.params.numeroBio)
    return reply.code(200).send(records)
  })

  /**
   * Retrieve a given Record
   */
  app.get('/api/v2/audits/:recordId', mergeSchemas(routeWithRecordId, protectedWithToken()), (request, reply) => {
    return reply.code(200).send(request.record)
  })

  /**
   * Create a new Record for a given Operator
   */
  app.post('/api/v2/operator/:numeroBio/records', mergeSchemas(
    createRecordSchema,
    operatorFromNumeroBio,
    protectedWithToken()
  ), async (request, reply) => {
    const { numeroBio } = request.params
    const { id: ocId, nom: ocLabel } = request.operator.organismeCertificateur
    const record = await createOrUpdateOperatorRecord(
      { numerobio: numeroBio, oc_id: ocId, oc_label: ocLabel, ...request.body },
      { user: request.user, copyParcellesData: request.body.importPrevious, previousRecordId: request.body.recordId }
    )
    return reply.code(200).send(normalizeRecord(record))
  })

  /**
   * Delete a given Record
   */
  app.delete('/api/v2/audits/:recordId', mergeSchemas(routeWithRecordId, protectedWithToken()), async (request, reply) => {
    const { user, record } = request
    await deleteRecord({ user, record })
    return reply.code(204).send()
  })

  /**
   * Partial update Record's metadata (top-level properties except features)
   * It also keep track of new HistoryEvent along the way, depending who and when you update feature properties
   */
  app.patch('/api/v2/audits/:recordId', mergeSchemas(protectedWithToken(), patchRecordSchema, routeWithRecordId), (request, reply) => {
    const { body: patch, user, record } = request

    return updateAuditRecordState({ user, record }, patch)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Add new feature entries to an existing collection
   */
  app.post('/api/v2/audits/:recordId/parcelles', mergeSchemas(protectedWithToken(), createFeatureSchema, routeWithRecordId), (request, reply) => {
    const { feature } = request.body
    const { user, record } = request

    return addRecordFeature({ user, record }, feature)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Partial update a feature collection (ie: mass action from the collection screen)
   *
   * Matching features are updated, features not present in payload or database are ignored
   */
  app.patch('/api/v2/audits/:recordId/parcelles', mergeSchemas(protectedWithToken(), patchFeatureCollectionSchema, routeWithRecordId), (request, reply) => {
    const { body: featureCollection, user, record } = request

    return patchFeatureCollection({ user, record }, featureCollection.features)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Partial update a single feature (ie: feature form from an editing modal)
   *
   * Absent properties are kept as is, new properties are added, existing properties are updated
   * ('culture' field is not a special case, it's just a regular property that can be replaced)
   */
  app.patch('/api/v2/audits/:recordId/parcelles/:featureId', mergeSchemas(protectedWithToken(), updateFeaturePropertiesSchema, routeWithRecordId), (request, reply) => {
    const { body: feature, user, record } = request
    const { featureId } = request.params

    return updateFeature({ featureId, user, record }, feature)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Delete a single feature
   */
  app.delete('/api/v2/audits/:recordId/parcelles/:featureId', mergeSchemas(protectedWithToken(), deleteSingleFeatureSchema, routeWithRecordId), (request, reply) => {
    const { user, record } = request
    const { reason } = request.body
    const { featureId } = request.params

    return deleteSingleFeature({ featureId, user, record }, { reason })
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  app.post('/api/v2/audits/:recordId/parcelles/:featureId/', mergeSchemas(protectedWithToken(), routeWithRecordId), (request, reply) => {
    const { user, record } = request
    const reason = request.body
    const featureId = request.params

    return addDividFeature(user, record, reason, featureId)
      .then(reply.code(200).send({ message: 'OK' }))
  })

  /**
   * Turn a Telepac XML or Telepac zipped Shapefile into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post('/api/v2/convert/telepac/geojson', mergeSchemas(protectedWithToken({ oc: true, cartobio: true })), async (request, reply) => {
    return parseTelepacArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  /**
   * Turn a Geofolia file into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post('/api/v2/convert/geofolia/geojson', mergeSchemas(protectedWithToken()), async (request, reply) => {
    const data = await request.file()

    return parseGeofoliaArchive(await data.toBuffer())
      .then(geojson => reply.send(geojson))
  })

  /**
   * Turn a geographical file workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post('/api/v2/convert/anygeo/geojson', mergeSchemas(protectedWithToken()), async (request, reply) => {
    return parseAnyGeographicalArchive(request.file())
      .then(geojson => reply.send(geojson))
  })

  /**
   * Retrieves all features associated to a PACAGE as a workeable FeatureCollection
   */
  app.get('/api/v2/import/pacage/:numeroPacage', mergeSchemas(protectedWithToken({ cartobio: true, oc: true }), routeWithPacage), async (request, reply) => {
    const { numeroPacage } = request.params

    return pacageLookup({ numeroPacage })
      .then(featureCollection => reply.send(featureCollection))
  })

  /**
   * Checks if an operator has Geofolink features
   * It triggers a data order, which has the benefit to break the waiting time in two
   */
  app.head('/api/v2/import/geofolia/:numeroBio', mergeSchemas(protectedWithToken({ cartobio: true, oc: true }), operatorFromNumeroBio, geofoliaImportSchema), async (request, reply) => {
    const { siret } = request.operator
    const { year } = request.query

    const isWellKnown = await geofoliaLookup(siret, year)

    return reply.code(isWellKnown === true ? 204 : 404).send()
  })

  /**
   * Retrieves all features associated to a given SIRET linked to a numeroBio
   */
  app.get('/api/v2/import/geofolia/:numeroBio', mergeSchemas(protectedWithToken({ cartobio: true, oc: true }), operatorFromNumeroBio), async (request, reply) => {
    const { siret } = request.operator

    const featureCollection = await geofoliaParcellaire(siret)

    if (!featureCollection) {
      return reply.code(202).send()
    }

    return reply.send(featureCollection)
  })

  /**
   * Retrieves all features associated to an EVV associated to a numeroBio
   * You still have to add geometries to the collection.
   * Features contains a 'cadastre' property with references to fetch
   */
  app.get('/api/v2/import/evv/:numeroEvv(\\d+)+:numeroBio(\\d+)', mergeSchemas(protectedWithToken({ cartobio: true, oc: true }), operatorFromNumeroBio), async (request, reply) => {
    const { numeroEvv } = request.params
    const { siret: expectedSiret } = request.operator

    if (!expectedSiret) {
      throw new InvalidRequestApiError('Le numéro SIRET de l\'opérateur n\'est pas renseigné sur le portail de Notification de l\'Agence Bio. Il est indispensable pour sécuriser la collecte du parcellaire viticole auprès des Douanes.')
    }

    return evvLookup({ numeroEvv })
      .then(({ siret }) => {
        if (!siret) {
          throw new NotFoundApiError('Ce numéro EVV est introuvable')
        } else if (siret !== expectedSiret) {
          throw new UnauthorizedApiError('les numéros SIRET du nCVI et de l\'opérateur Agence Bio ne correspondent pas.')
        }
      })
      .then(() => evvParcellaire({ numeroEvv }))
      .then(featureCollection => {
        if (featureCollection.features.length === 0) {
          throw new NotFoundApiError('Ce numéro EVV ne retourne pas de parcelles.')
        }

        return reply.send(featureCollection)
      })
  })

  app.post('/api/v2/certification/parcelles', mergeSchemas(protectedWithToken({ oc: true }), {
    preParsing: async (request, reply, payload) => {
      const stream = payload.pipe(stripBom())

      request.APIResult = await parcellaireStreamToDb(stream, request.organismeCertificateur)
      request.headers['content-length'] = '2'
      return new PassThrough().end('{}')
    }
  }), (request, reply) => {
    const { count, errors, warnings } = request.APIResult

    if (errors.length > 0) {
      return reply.code(400).send({
        nbObjetTraites: count,
        nbObjetAcceptes: count - errors.length,
        nbObjetRefuses: errors.length,
        listeProblemes: errors.map(([index, message]) => `[#${index}] ${message}`),
        listeWarning: warnings && warnings.length > 0 ? warnings.map(([index, message]) => `[#${index}] ${message}`) : []
      })
    }

    return reply.code(202).send({
      nbObjetTraites: count
    })
  })

  app.get('/api/v2/certification/parcellaires', mergeSchemas(protectedWithToken({ oc: true })), async (request, reply) => {
    reply.header('Content-Type', 'application/json')
    const records = iterateOperatorLastRecords(
      request.organismeCertificateur.id,
      {
        anneeAudit: request.query.anneeAudit,
        statut: request.query.statut
      }
    )
    // pass all records through recordToApi
    const apiRecords = async function * () {
      for await (const record of records) {
        yield recordToApi(record)
      }
    }

    const outputStream = JSONStream.stringify()
    stream.Readable.from(apiRecords()).pipe(outputStream)
    return reply.code(200).send(outputStream)
  })

  app.get('/api/v2/certification/parcellaire/:numeroBio', mergeSchemas(protectedWithToken({ oc: true }), operatorFromNumeroBio), async (request, reply) => {
    const record = await getOperatorLastRecord(request.params.numeroBio, {
      anneeAudit: request.query.anneeAudit,
      statut: request.query.statut
    })
    return reply.code(200).send(recordToApi(record))
  })

  app.get('/api/v2/user/verify', mergeSchemas(protectedWithToken({ oc: true, cartobio: true }), sandboxSchema, internalSchema), (request, reply) => {
    const { user, organismeCertificateur } = request

    return reply.send(user ?? organismeCertificateur)
  })

  /**
   * Exchange a notification.agencebio.org token for a CartoBio token
   */
  app.get('/api/v2/user/exchangeToken', internalSchema, async (request, reply) => {
    const { error, decodedToken, token } = verifyNotificationAuthorization(request.headers.authorization)

    if (error) {
      return new UnauthorizedApiError('impossible de vérifier ce jeton', { cause: error })
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
  app.get('/api/auth-provider/agencebio/callback', mergeSchemas(sandboxSchema, hiddenSchema), async (request, reply) => {
    // forwards to the UI the user-selected tab
    const { mode = '', returnto = '' } = stateCache.get(request.query.state)
    const { token } = await app.agenceBioOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const userProfile = await getUserProfileFromSSOToken(token.access_token)
    const cartobioToken = sign(userProfile)

    return reply.redirect(`${config.get('frontendUrl')}/login?mode=${mode}&returnto=${returnto}#token=${cartobioToken}`)
  })
})

if (require.main === module) {
  db.query('SHOW server_version;').then(async ({ rows }) => {
    const { server_version: pgVersion } = rows[0]
    console.log(`Postgres connection established, v${pgVersion}`)

    await app.ready()
    await app.swagger()

    const address = await app.listen({
      host: config.get('host'),
      port: config.get('port')
    })

    console.log(`Running env:${config.get('env')} on ${address}`)
  }, () => console.error('Failed to connect to database'))
}

module.exports = app
