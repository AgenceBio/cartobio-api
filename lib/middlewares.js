'use strict'

const { createVerifier } = require('fast-jwt')
const MatomoTracker = require('matomo-tracker')
const env = require('./app.js').env()
const { version: apiVersion } = require('../package.json')

const { NODE_ENV, MATOMO_SITE_ID, MATOMO_TRACKER_URL } = env

const matomo = new MatomoTracker(MATOMO_SITE_ID, MATOMO_TRACKER_URL)

const noop = () => {}

const decodeToken = ({ name, JWT_SECRET }) => {
  const verifyToken = createVerifier({ key: JWT_SECRET })

  return async (request, reply) => {
    const token = (request.headers.authorization || request.query.access_token || '').replace(/^Bearer /, '')

    if (!token) {
      return
    }

    try {
      reply.header('X-Api-Version', apiVersion)
      request[name] = verifyToken(token)

      if (request[name].organismeCertificateurId && !request[name].ocId) {
        request[name].ocId = request[name].organismeCertificateurId
      }

      return
    } catch (error) {
      matomo.trackBulk([{
        ua: apiVersion,
        cvar: JSON.stringify({ token, error: error.message, NODE_ENV }),
        e_c: 'api/v1',
        e_a: 'error',
        e_n: error.message
      }])

      return reply.code(401).send({
        error: 'We could not verify the provided token.'
      })
    }
  }
}

const enforceToken = ({ name }) => {
  return async (request, reply) => {
    if (request[name] === null) {
      return reply.code(401).send({
        error: 'An API token must be provided.'
      })
    }
  }
}

const compareOperatorOutputAndToken = ({ name }) => {
  return async (request, reply, payload) => {
    const { operator } = payload
    const { organismeCertificateur } = operator ?? {}
    const { organismeCertificateurId: expectedOcId } = request[name] ?? {}

    if (organismeCertificateur && expectedOcId && expectedOcId !== organismeCertificateur.id) {
      reply.code(403)
      throw new Error('You cannot access this ressource.')
    }

    return payload
  }
}

/**
 * [track description]
 * @type {Object.<Request, APIToken>}
 */
const track = NODE_ENV !== 'dev'
  ? ({ request, decodedToken }) => {
      const { url = '/' } = request.raw

      matomo.trackBulk([{
        ua: apiVersion,
        cvar: JSON.stringify({ decodedToken, NODE_ENV }),
        e_c: 'api/v1',
        e_a: url,
        e_n: `oc:${decodedToken.organismeCertificateurId ?? decodedToken.ocId}`
      }])
    }
  : noop

module.exports = { compareOperatorOutputAndToken, decodeToken, enforceToken, track }
