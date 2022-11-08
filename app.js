'use strict'

const app = require('fastify')({
  logger: true
})

const Sentry = require('@sentry/node')
const { sign } = require('jsonwebtoken')
const { all: deepmerge } = require('deepmerge')
const pick = require('lodash/pick')

const parcelsFixture = require('./test/fixtures/parcels.json')
const summaryFixture = require('./test/fixtures/summary.json')
const { featureCollection } = require('@turf/helpers')

const { version: apiVersion } = require('./package.json')
const JWT_SECRET = Buffer.from(process.env.CARTOBIO_JWT_SECRET, 'base64')

const { verify, track: _track, enforceParams } = require('./lib/middlewares.js')
const { getOperatorParcels, getOperatorSummary } = require('./lib/parcels.js')
const { fetchAuthToken, fetchUserProfile, operatorLookup, fetchCustomersByOperator, getCertificationBodyForPacage } = require('./lib/providers/agence-bio.js')
const { updateOperator, updateOperatorParcels, getOperator } = require('./lib/providers/cartobio.js')
const { parseShapefileArchive } = require('./lib/providers/telepac.js')
const { parseGeofoliaArchive } = require('./lib/providers/geofolia.js')
const { getMesParcellesOperator } = require('./lib/providers/mes-parcelles.js')
const { createCard } = require('./lib/services/trello.js')
const env = require('./lib/app.js').env()

const { sandboxSchema, ocSchema, internalSchema } = require('./lib/routes/index.js')
const { routeWithNumeroBio, routeWithPacage } = require('./lib/routes/index.js')
const { loginSchema, tryLoginSchema } = require('./lib/routes/login.js')
const { operatorSchema } = require('./lib/routes/operators.js')
const { parcelsOperatorSchema } = require('./lib/routes/parcels.js')

const db = require('./lib/db.js')

// Application is hosted on localhost:8000 by default
const { PORT, HOST, SENTRY_DSN, NODE_ENV } = env
const reportErrors = SENTRY_DSN && NODE_ENV === 'production'

// Sentry error reporting setup
if (reportErrors) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: 'cartobio-api@' + process.env.npm_package_version
  })
}

// Track events in Matomo in production only
const track = reportErrors ? _track : () => {}

// Configure server
app.register(require('fastify-cors'), {
  origin: true,
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Accept-Encoding', 'Authorization']
})

// Expose OpenAPI schema and Swagger documentation
app.register(require('fastify-swagger'), {
  routePrefix: '/api/documentation',
  exposeRoute: true,
  hideUntagged: true,
  swagger: {
    info: {
      title: 'CartBio API',
      version: apiVersion
    },
    host: NODE_ENV === 'production' ? 'cartobio.org' : `${HOST}:${PORT}`,
    schemes: [NODE_ENV === 'production' ? 'https' : 'http'],
    externalDocs: {
      url: 'https://cartobio.agencebio.org/api',
      description: 'Consulter le guide d\'utilisation de l\'API CartoBio'
    },
    tags: [
      { name: 'Bac à sable', description: 'Pour s\'entraîner à utiliser l\'API' },
      { name: 'Organisme de certification', description: 'Données géographiques à destination des organismes de certification' },
      { name: 'cartobio.org', description: 'Interactions avec l\'application cartobio.org' }
    ],
    securityDefinitions: {
      bearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'Token JWT passé en tant qu\'entête HTTP (donc préfixé par `Bearer `).'
      },
      tokenAuth: {
        type: 'apiKey',
        name: 'access_token',
        in: 'query',
        description: 'Token JWT passé en tant que paramètre d\'URL.'
      }
    }
  }
})

// Enable file upload
app.register(require('fastify-multipart'))

// Routes to protect with a JSON Web Token
app.decorateRequest('decodedToken', null)
const protectedRouteOptions = {
  schema: {
    security: [
      { bearerAuth: [] },
      { tokenAuth: [] }
    ]
  },

  preValidation: [
    verify({ JWT_SECRET }),
    enforceParams('ocId')
  ]
}

// Begin Public API routes
app.get('/api/v1/version', sandboxSchema, (request, reply) => {
  return reply.send({ version: apiVersion })
})

app.get('/api/v1/test', deepmerge([sandboxSchema, protectedRouteOptions]), (request, reply) => {
  const { decodedToken } = request
  track({ request, decodedToken })

  return reply.send({ test: 'OK' })
})

app.get('/api/v1/summary', deepmerge([ocSchema, protectedRouteOptions]), (request, reply) => {
  const { decodedToken } = request
  const { test: isTest, ocId } = decodedToken

  // track({ request, decodedToken })

  if (isTest === true) {
    return reply.code(200).send(summaryFixture)
  }

  getOperatorSummary({ ocId })
    .then(geojson => reply.code(200).send(geojson))
    .catch(error => {
      request.log.error(`Failed to return summary for OC ${ocId} because of this error "%s"`, error.message)
      request.log.debug(error.stack)

      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to assemble summary data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

app.get('/api/v1/parcels', deepmerge([ocSchema, protectedRouteOptions]), (request, reply) => {
  const { decodedToken } = request
  const { test: isTest, ocId } = decodedToken

  track({ request, decodedToken })

  if (isTest === true) {
    return reply.code(200).send(parcelsFixture)
  }

  getOperatorParcels({ ocId })
    .then(geojson => reply.code(200).send(geojson))
    .catch(error => {
      request.log.error(`Failed to return parcels for OC ${ocId} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to assemble parcels data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

app.get('/api/v1/parcels/operator/:numeroBio', deepmerge([ocSchema, protectedRouteOptions, routeWithNumeroBio]), (request, reply) => {
  const { decodedToken, params } = request
  const { test: isTest, ocId } = decodedToken
  const { numeroBio } = params

  track({ request, decodedToken })

  if (isTest === true) {
    return reply.code(200).send(
      featureCollection(parcelsFixture.features.filter(({ properties }) => properties.numerobio === Number(numeroBio)))
    )
  }

  getOperatorParcels({ ocId, numeroBio })
    .then(geojson => reply.code(200).send(geojson))
    .catch(error => {
      request.log.error(`Failed to return parcels for OC ${ocId} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to assemble parcels data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.post('/api/v1/login', deepmerge([internalSchema, loginSchema]), (request, reply) => {
  const { email, password: motDePasse } = request.body

  const auth = fetchAuthToken({ email, motDePasse })

  auth.catch(({ message: error }) => reply.code(401).send({ error }))

  auth
    .then(token => fetchUserProfile(token))
    .then(({ userProfile, token }) => {
      reply.code(200).send({
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
          // }, JWT_SECRET, { expiresIn: '14d' })
        }, JWT_SECRET)
      })
    }, error => reportErrors && Sentry.captureException(error))
})

/**
 * @private
 */
app.post('/api/v1/tryLogin', deepmerge([internalSchema, tryLoginSchema]), (request, reply) => {
  const { q } = request.body

  return operatorLookup({ q })
    .then(userProfiles => reply.code(200).send(userProfiles))
    .catch(error => {
      request.log.error(`Failed to login with ${q} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to retrieve operator data. We have been notified about and will soon start fixing this issue.'
      })
    })
})
/**
 * @todo lookup for PACAGE stored in the `cartobio_operators` table
 * @private
 */
app.get('/api/v1/pacage/:numeroPacage', deepmerge([internalSchema, protectedRouteOptions, routeWithPacage]), (request, reply) => {
  const { numeroPacage } = request.params

  getCertificationBodyForPacage({ numeroPacage })
    .then(({ ocId, numeroBio } = {}) => {
      return reply.code(200).send({ numeroPacage, numeroBio, ocId })
    })
    .catch(error => {
      request.log.error(`Failed to fetch ocId for ${numeroPacage} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to retrieve operator data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.patch('/api/v1/operator/:numeroBio', deepmerge([internalSchema, protectedRouteOptions, operatorSchema]), (request, reply) => {
  const { decodedToken, body } = request
  const { ocId } = decodedToken
  const { numeroBio } = request.params

  // track({ request, decodedToken })

  updateOperator({ numeroBio, ocId }, body)
    .then(() => getOperatorSummary({ numeroBio, ocId }))
    .then(geojson => reply.code(200).send(geojson))
    .catch(error => {
      request.log.error(`Failed to update operator ${numeroBio} for OC ${ocId} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to update operator data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

app.get('/api/v2/stats', internalSchema, (request, reply) => {
  return db.query("SELECT COUNT(parcelles) as count, SUM(JSONB_ARRAY_LENGTH(parcelles->'features')::bigint) as parcelles_count FROM cartobio_operators WHERE metadata->>'source' != '';")
    .then(({ rows }) => reply.code(200).send({ stats: rows[0] }))
})

/**
 * @private
 */
app.post('/api/v2/certification/operators/search', internalSchema, (request, reply) => {
  const { ocId, input: nom } = request.body

  fetchCustomersByOperator({ ocId, nom })
    .then(operators => reply.code(200).send({ operators: operators.map(o => pick(o, ['id', 'nom', 'dateEngagement'])) }))
    .catch(error => {
      request.log.error(`Failed to fetch operators for ${ocId} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to retrieve certification data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.get('/api/v2/operator/:operatorId', internalSchema, (request, reply) => {
  const { operatorId } = request.params

  // track({ request, decodedToken })

  getOperator({ operatorId })
    .then(result => reply.code(200).send(result))
    .catch(error => {
      request.log.error(`Failed to fetch operator #${operatorId} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to retrieve operator data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.post('/api/v2/operator/:operatorId/parcelles', (request, reply) => {
  const { body } = request
  const { operatorId } = request.params

  // track({ request, decodedToken })

  updateOperatorParcels({ operatorId }, body)
    .then(result => reply.code(200).send(result))
    .catch(error => {
      request.log.error(`Failed to update operator ${operatorId} parcels because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to update operator data. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.post('/api/v1/convert/shapefile/geojson', async (request, reply) => {
  parseShapefileArchive(request.file())
    .then(geojson => reply.send(geojson))
    .catch(error => {
      request.log.error('Failed to parse Shapefile archive because of this error "%s"', error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to transform the Shapefile into GeoJSON. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.post('/api/v1/convert/geofolia/geojson', async (request, reply) => {
  parseGeofoliaArchive(request.file())
    .then(geojson => reply.send(geojson))
    .catch(error => {
      request.log.error('Failed to parse Geofolia archive because of this error "%s"', error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to transform the Shapefile into GeoJSON. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.post('/api/v2/import/mesparcelles/login', async (request, reply) => {
  const { email, password, server } = request.body

  getMesParcellesOperator({ email, password, server })
    .then(geojson => reply.send(geojson))
    .catch(error => {
      request.log.error('Failed to import MesParcelles data because of this error "%o"', error)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to transform the Shapefile into GeoJSON. We have been notified about and will soon start fixing this issue.'
      })
    })
})

/**
 * @private
 */
app.post('/api/v1/parcels/operator/:numeroBio', deepmerge([internalSchema, protectedRouteOptions, parcelsOperatorSchema]), async (request, reply) => {
  const { numeroBio } = request.params
  const { sender, uploads, text } = request.body
  const { TRELLO_API_KEY: key, TRELLO_API_TOKEN: token, TRELLO_LIST_ID: idList } = env

  try {
    await createCard({
      key,
      token,
      idList,
      uploads,
      name: `Parcelles pour l'opérateur bio n°${numeroBio}`,
      desc: `Envoyé par ${sender.userName} • OC n°${sender.ocId} • User n°${sender.userId} • ${sender.userEmail}
----

    ${text}`
    })

    reply.code(204).send()
  } catch (error) {
    request.log.error('Failed to send email because of this error "%s"', error.message)
    reportErrors && Sentry.captureException(error)

    reply.code(500).send({
      error: 'Sorry, we failed to process your message. We have been notified about and will soon start fixing this issue.'
    })
  }
})

if (require.main === module) {
  db.query('SHOW server_version;').then(({ rows }) => {
    const { server_version: pgVersion } = rows[0]
    console.log(`Postgres connection established, v${pgVersion}`)

    app.listen(PORT, HOST, (error, address) => {
      if (error) {
        return console.error(error)
      }

      console.log(`Running env:${NODE_ENV} on ${address}`)
    })
  }, () => console.error('Failed to connect to database'))
}

module.exports = app
