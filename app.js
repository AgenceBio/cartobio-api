'use strict'

const app = require('fastify')({
  logger: true
})

const Sentry = require('@sentry/node')
const { sign } = require('jsonwebtoken')
const deepmerge = require('deepmerge')

const parcelsFixture = require('./test/fixtures/parcels.json')
const summaryFixture = require('./test/fixtures/summary.json')
const { featureCollection } = require('@turf/helpers')

const { version: apiVersion } = require('./package.json')
const JWT_SECRET = Buffer.from(process.env.CARTOBIO_JWT_SECRET, 'base64')

const { verify, track, enforceParams } = require('./lib/middlewares.js')
const { getOperatorParcels, getOperatorSummary } = require('./lib/parcels.js')
const { fetchAuthToken, fetchUserProfile, getCertificationBodyForPacage } = require('./lib/providers/agence-bio.js')
const { updateOperator } = require('./lib/providers/cartobio.js')
const { createCard } = require('./lib/services/trello.js')
const env = require('./lib/app.js').env()

const { operatorSchema } = require('./lib/routes/operators.js')

const db = require('./lib/db.js')

// Application is hosted on localhost:8000 by default
const { PORT, HOST, SENTRY_DSN, NODE_ENV } = env
const reportErrors = SENTRY_DSN && NODE_ENV === 'production'
const MEGABYTE = 1048576

// Sentry error reporting setup
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: 'cartobio-api@' + process.env.npm_package_version
  })
}

// Configure server
app.register(require('fastify-cors'), {
  origin: true,
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Accept-Encoding', 'Authorization']
}))

// Routes to protect with a JSON Web Token
app.decorateRequest('decodedToken', {})
const protectedRouteOptions = {
  schema: {
    querystring: {
      access_token: { type: 'string' }
    }
  },
  preValidation: [
    verify({ JWT_SECRET }),
    enforceParams('ocId')
  ]
}

app.get('/api/v1/version', (request, reply) => {
  return reply.send({ version: apiVersion })
})

app.get('/api/v1/test', protectedRouteOptions, (request, reply) => {
  const { decodedToken } = request
  track({ request, decodedToken })

  return reply.send({ test: 'OK' })
})

app.post('/api/v1/login', (request, reply) => {
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

app.get('/api/v1/summary', protectedRouteOptions, (request, reply) => {
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

/**
 * @todo lookup for PACAGE stored in the `cartobio_operators` table
 */
app.get('/api/v1/pacage/:numeroPacage', protectedRouteOptions, (request, reply) => {
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

app.patch('/api/v1/operator/:numeroBio', deepmerge(protectedRouteOptions, { schema: operatorSchema }), (request, reply) => {
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

app.get('/api/v1/parcels', protectedRouteOptions, (request, reply) => {
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

app.get('/api/v1/parcels/operator/:numeroBio', protectedRouteOptions, (request, reply) => {
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

app.post('/api/v1/parcels/operator/:numeroBio', deepmerge(protectedRouteOptions, { bodyLimit: 16 * MEGABYTE }), async (request, reply) => {
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
      desc: `Envoyé par ${sender.userName} • OC ${sender.ocId} (#${sender.userId}, ${sender.userEmail})
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
