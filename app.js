'use strict'

const app = require('fastify')({
  logger: true
})

const cors = require('cors')
const Sentry = require('@sentry/node')
const { sign } = require('jsonwebtoken')

const parcelsFixture = require('./test/fixtures/parcels.json')
const summaryFixture = require('./test/fixtures/summary.json')
const { featureCollection } = require('@turf/helpers')

const { version: apiVersion } = require('./package.json')
const JWT_SECRET = Buffer.from(process.env.CARTOBIO_JWT_SECRET, 'base64')

const { verify, track, enforceParams } = require('./lib/middlewares.js')
const { getOperatorParcels, getOperatorSummary } = require('./lib/parcels.js')
const { fetchAuthToken, fetchUserProfile } = require('./lib/providers/agence-bio.js')
const env = require('./lib/app.js').env()

// Application is hosted on localhost:8000 by default
const { PORT, HOST, SENTRY_DSN, NODE_ENV } = env
const reportErrors = SENTRY_DSN && NODE_ENV === 'production'

// Sentry error reporting setup
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: 'cartobio-api@' + process.env.npm_package_version
  })
}

// Configure server
app.use(cors({
  origin: true,
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Accept-Encoding', 'Authorization']
}))

// Routes to protect with a JSON Web Token
app.decorateRequest('decodedToken', {})
const protectedRouteOptions = {
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

app.get('/api/v1/summary', protectedRouteOptions, (request, reply) => {
  const { decodedToken } = request
  const { test: isTest, ocId } = decodedToken

  track({ request, decodedToken })

  if (isTest === true) {
    return reply.code(200).send(summaryFixture)
  }

  getOperatorSummary({ ocId })
    .then(geojson => reply.code(200).send(geojson))
    .catch(error => {
      request.log.error(`Failed to return summary for OC ${ocId} because of this error "%s"`, error.message)
      reportErrors && Sentry.captureException(error)

      reply.code(500).send({
        error: 'Sorry, we failed to assemble summary data. We have been notified about and will soon start fixing this issue.'
      })
    })
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

if (require.main === module) {
  app.listen(PORT, HOST, (error, address) => {
    if (error) {
      return console.error(error)
    }

    console.log(`Running on ${address}`)
  })
}

module.exports = app
