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

const { fetchOperatorByNumeroBio, getUserProfileById, getUserProfileFromSSOToken, verifyNotificationAuthorization, fetchUserOperators, fetchCustomersByOc } = require('./lib/providers/agence-bio.js')
const { addRecordFeature, addDividFeature, patchFeatureCollection, updateAuditRecordState, updateFeature, createOrUpdateOperatorRecord, parcellaireStreamToDb, deleteSingleFeature, getRecords, deleteRecord, getOperatorLastRecord, searchControlBodyRecords, getDepartement, recordSorts, pinOperator, unpinOperator, consultOperator, getDashboardSummary, exportDataOcId, searchForAutocomplete, getImportPAC, hideImport } = require('./lib/providers/cartobio.js')
const { generatePDF, getAttestationProduction } = require('./lib/providers/export-pdf.js')
const { evvLookup, evvParcellaire, pacageLookup, iterateOperatorLastRecords } = require('./lib/providers/cartobio.js')
const { parseAnyGeographicalArchive } = require('./lib/providers/gdal.js')
const { parseTelepacArchive } = require('./lib/providers/telepac.js')
const { parseGeofoliaArchive, geofoliaLookup, geofoliaParcellaire } = require('./lib/providers/geofolia.js')
const { InvalidRequestApiError, NotFoundApiError } = require('./lib/errors.js')

const { mergeSchemas, swaggerConfig, CartoBioDecoratorsPlugin, dashboardSummarySchema, autocompleteSchema } = require('./lib/routes/index.js')
const { sandboxSchema, internalSchema, hiddenSchema } = require('./lib/routes/index.js')
const { operatorFromNumeroBio, operatorFromRecordId, protectedWithToken, routeWithRecordId, routeWithPacage, checkCertificationStatus } = require('./lib/routes/index.js')
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
const { getPinnedOperators, getConsultedOperators, addRecordData } = require('./lib/outputs/operator.js')
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

  /**
   * @private
   */
  app.post('/api/v2/certification/search', mergeSchemas(certificationBodySearchSchema, protectedWithToken()), async (request, reply) => {
    const { input, page, limit, filter } = request.body
    const { id: ocId } = request.user.organismeCertificateur

    return reply.code(200).send(searchControlBodyRecords({ ocId, userId: request.user.id, input, page, limit, filter }))
  })

  /**
   * @private
   */
  app.get('/api/v2/certification/autocomplete', mergeSchemas(autocompleteSchema, protectedWithToken()), async (request, reply) => {
    const { search } = request.query
    const { id: userId, organismeCertificateur } = request.user

    return reply.code(200).send(searchForAutocomplete(organismeCertificateur?.id, userId, search))
  })

  /**
   * @private
   * Retrieve operators for a given user
   */
  app.get('/api/v2/operators', mergeSchemas(protectedWithToken({ cartobio: true }), operatorsSchema), async (request, reply) => {
    const { id: userId } = request.user
    const { search, limit, offset } = request.query

    return Promise.all(
      [
        fetchUserOperators(userId),
        getPinnedOperators(request.user.id)
      ]
    ).then(([res, pinnedOperators]) => {
      const paginatedOperators = res.operators
        .filter((e) => {
          if (!search) {
            return true
          }

          const userInput = search.toLowerCase().trim()

          return e.denominationCourante.toLowerCase().includes(userInput) ||
            e.numeroBio.toString().includes(userInput) ||
            e.nom.toLowerCase().includes(userInput) ||
            e.siret.toLowerCase().includes(userInput)
        })
        .toSorted(recordSorts('fn', 'notifications', 'desc'))
        .slice(offset, offset + limit)
        .map((o) => ({ ...o, epingle: pinnedOperators.includes(+o.numeroBio) }))

      return reply.code(200).send({ nbTotal: res.operators.length, operators: paginatedOperators })
    })
  })

  /**
   * @private
   * Retrieve operators for a given user for their dashboard
   */
  app.get('/api/v2/operators/dashboard', mergeSchemas(protectedWithToken({ oc: true, cartobio: true })), async (request, reply) => {
    const { id: userId } = request.user
    const { id: ocId } = request.user.organismeCertificateur

    return Promise.all([getPinnedOperators(userId), getConsultedOperators(userId)])
      .then(async ([pinnedNumerobios, consultedNumerobio]) => {
        const uniqueNumerobios = [...new Set([...pinnedNumerobios, ...consultedNumerobio])]
        const operators = (
          await fetchCustomersByOc(ocId))
          .filter(
            (operator) =>
              uniqueNumerobios.includes(operator.numeroBio) &&
              operator.notifications.certification_state !== 'ARRETEE' &&
              operator.notifications.organismeCertificateurId === ocId &&
              ['ENGAGEE', 'ENGAGEE FUTUR'].includes(operator.notifications.etatCertification)
          )
        return Promise.all(operators.map((o) => addRecordData(o))).then(
          (operatorsWithData) => reply.code(200).send({
            pinnedOperators: pinnedNumerobios.filter((numeroBio) => (operatorsWithData.find((o) => o.numeroBio === numeroBio))).map((numeroBio) => ({ ...operatorsWithData.find((o) => o.numeroBio === numeroBio), epingle: true })),
            consultedOperators: consultedNumerobio.filter((numeroBio) => (operatorsWithData.find((o) => o.numeroBio === numeroBio))).map((numeroBio) => ({ ...operatorsWithData.find((o) => o.numeroBio === numeroBio), epingle: pinnedNumerobios.includes(numeroBio) }))
          })
        )
      })
  })

  /**
   * @private
   * Retrieve operators for a given user for their dashboard
   */
  app.post('/api/v2/operators/dashboard-summary', mergeSchemas(dashboardSummarySchema, protectedWithToken({ oc: true, cartobio: true })), async (request, reply) => {
    const { departements, anneeReferenceControle } = request.body
    const { id: ocId } = request.user.organismeCertificateur

    return reply.code(200).send(getDashboardSummary(ocId, departements, anneeReferenceControle))
  })

  /**
   * @private
   * Retrieve an operator
   */
  app.get('/api/v2/operator/:numeroBio', mergeSchemas(protectedWithToken(), operatorFromNumeroBio), async (request, reply) => {
    const pinnedOperators = await getPinnedOperators(request.user.id)

    request.operator.epingle = pinnedOperators.includes(+request.operator.numeroBio)

    return reply.code(200).send(request.operator)
  })

  /**
   * @private
   * Pin an operator
   */
  app.post('/api/v2/operator/:numeroBio/pin', mergeSchemas(protectedWithToken()), async (request, reply) => {
    await pinOperator(request.params.numeroBio, request.user.id)

    return reply.code(200).send({ epingle: true })
  })

  /**
   * @private
   * Unpin an operator
   */
  app.post('/api/v2/operator/:numeroBio/unpin', mergeSchemas(protectedWithToken()), async (request, reply) => {
    await unpinOperator(request.params.numeroBio, request.user.id)

    return reply.code(200).send({ epingle: false })
  })

  /**
   * @private
   * Mark an operator as consulted
   */
  app.post('/api/v2/operator/:numeroBio/consulte', mergeSchemas(protectedWithToken()), async (request, reply) => {
    await consultOperator(request.params.numeroBio, request.user.id)

    return reply.code(204).send()
  })

  /**
  /**
   * @private
   * Retrieve an operator records
   */
  app.get('/api/v2/operator/:numeroBio/records', mergeSchemas(protectedWithToken(), operatorFromNumeroBio), async (request, reply) => {
    const records = await getRecords(request.params.numeroBio)

    if (!request.user.organismeCertificateur || request.user.organismeCertificateur.id === request.operator.organismeCertificateur.id) {
      return reply.code(200).send(records)
    }

    return reply.code(200).send(records.filter((r) => r.oc_id === request.user.organismeCertificateur.id))
  })

  /**
   * @private
   * Checks if operator can import a pac record from 2025
   */
  app.get('/api/v2/operator/:numeroBio/importData', mergeSchemas(protectedWithToken()), async (request, reply) => {
    const res = await getImportPAC(request.params.numeroBio)
    return reply.code(200).send({ data: res })
  })

  /**
   * @private
   * Hide import PAC 2025 notif
   */
  app.patch('/api/v2/operator/:numeroBio/hideNotif', mergeSchemas(protectedWithToken()), async (request, reply) => {
    await hideImport(request.params.numeroBio)
    return reply.code(204).send()
  })

  /**
   * Retrieve a given Record
   */
  app.get('/api/v2/audits/:recordId', mergeSchemas(protectedWithToken(), operatorFromRecordId), (request, reply) => {
    return reply.code(200).send(request.record)
  })

  /**
   * Retrieve a given Record
   */
  app.get('/api/v2/audits/:recordId/has-attestation-production', mergeSchemas(protectedWithToken(), operatorFromRecordId), async (request, reply) => {
    const attestation = await getAttestationProduction(request.record.record_id)

    return reply.code(200).send({ hasAttestationProduction: !!attestation })
  })

  /**
   * Create a new Record for a given Operator
   */
  app.post('/api/v2/operator/:numeroBio/records', mergeSchemas(
    createRecordSchema,
    operatorFromNumeroBio,
    checkCertificationStatus,
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
  app.delete('/api/v2/audits/:recordId', mergeSchemas(protectedWithToken(), routeWithRecordId), async (request, reply) => {
    const { user, record } = request
    await deleteRecord({ user, record })
    return reply.code(204).send()
  })

  /**
   * Partial update Record's metadata (top-level properties except features)
   * It also keep track of new HistoryEvent along the way, depending who and when you update feature properties
   */
  app.patch('/api/v2/audits/:recordId', mergeSchemas(
    protectedWithToken(),
    patchRecordSchema,
    operatorFromRecordId,
    routeWithRecordId
  ), (request, reply) => {
    const { body: patch, user, record, operator } = request

    return updateAuditRecordState({ user, record, operator }, patch)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Add new feature entries to an existing collection
   */
  app.post('/api/v2/audits/:recordId/parcelles', mergeSchemas(
    protectedWithToken(),
    createFeatureSchema,
    routeWithRecordId,
    operatorFromRecordId
  ), (request, reply) => {
    const { feature } = request.body
    const { user, record, operator } = request

    return addRecordFeature({ user, record, operator }, feature)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Partial update a feature collection (ie: mass action from the collection screen)
   *
   * Matching features are updated, features not present in payload or database are ignored
   */
  app.patch('/api/v2/audits/:recordId/parcelles', mergeSchemas(
    protectedWithToken(),
    patchFeatureCollectionSchema,
    routeWithRecordId,
    operatorFromRecordId
  ), (request, reply) => {
    const { body: featureCollection, user, record, operator } = request

    return patchFeatureCollection({ user, record, operator }, featureCollection.features)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Partial update a single feature (ie: feature form from an editing modal)
   *
   * Absent properties are kept as is, new properties are added, existing properties are updated
   * ('culture' field is not a special case, it's just a regular property that can be replaced)
   */
  app.patch('/api/v2/audits/:recordId/parcelles/:featureId', mergeSchemas(
    protectedWithToken(),
    updateFeaturePropertiesSchema,
    routeWithRecordId,
    operatorFromRecordId
  ), (request, reply) => {
    const { body: feature, user, record, operator } = request
    const { featureId } = request.params

    return updateFeature({ featureId, user, record, operator }, feature)
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  /**
   * Delete a single feature
   */
  app.delete('/api/v2/audits/:recordId/parcelles/:featureId', mergeSchemas(
    protectedWithToken(),
    deleteSingleFeatureSchema,
    routeWithRecordId,
    operatorFromRecordId
  ), (request, reply) => {
    const { user, record, operator } = request
    const { reason } = request.body
    const { featureId } = request.params

    return deleteSingleFeature({ featureId, user, record, operator }, { reason })
      .then(record => reply.code(200).send(normalizeRecord(record)))
  })

  app.post('/api/v2/audits/:recordId/parcelles/:featureId', mergeSchemas(protectedWithToken(), routeWithRecordId, operatorFromRecordId), (request, reply) => {
    const { user, record, operator } = request
    const reason = request.body
    const featureId = request.params

    return addDividFeature(user, record, operator, reason, featureId)
      .then(record => reply.code(200).send(normalizeRecord(record)))
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
      nbObjetTraites: count,
      listeWarning: warnings && warnings.length > 0 ? warnings.map(([index, message]) => `[#${index}] ${message}`) : []
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
    return reply.code(200).send(await recordToApi(record))
  })

  app.get('/api/v2/pdf/:numeroBio/:recordId', mergeSchemas(protectedWithToken()), async (request, reply) => {
    const force = request.query.force_refresh === 'true' ?? false

    try {
      const gen = generatePDF(request.params.numeroBio, request.params.recordId, force)
      const numberParcelle = (await gen.next()).value

      console.log(numberParcelle)
      if (numberParcelle > 80) {
        reply.code(204).send()
      }

      const pdf = (await gen.next()).value
      if (numberParcelle <= 80) {
        return reply.code(200).send(pdf)
      }
    } catch (e) {
      return reply.code(400).send({ message: e.message })
    }
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

  app.get('/api/v2/departements', mergeSchemas(protectedWithToken()), async (request, reply) => {
    const departements = await getDepartement()
    return reply.code(200).send(departements)
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

  app.post('/api/v2/exportParcellaire', mergeSchemas(protectedWithToken({ oc: true, cartobio: true })), async (request, reply) => {
    const data = await exportDataOcId(request.user.organismeCertificateur.id, request.body.payload, request.user.id)
    if (data === null) {
      throw new Error("Une erreur s'est produite, impossible d'exporter les parcellaires")
    }
    return reply.code(200).send(data)
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
