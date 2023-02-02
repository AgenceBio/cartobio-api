'use strict'

const { createVerifier } = require('fast-jwt')
const MatomoTracker = require('matomo-tracker')
const { version: apiVersion } = require('../package.json')
const apiMajorVersion = apiVersion.split('.')[0]

/**
 * @typedef {import('fastify').FastifyRequest} FastifyRequest
 * @typedef {import('fastify').FastifyReply} FastifyReply
 */

function decodeToken ({ name, JWT_SECRET }) {
  const verifyToken = createVerifier({ key: JWT_SECRET })

  return async function decodeTokenMiddleware (request, reply) {
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
      return reply.code(401).send({
        error: 'We could not verify the provided token.'
      })
    }
  }
}

function decodeTokenWithPK ({ name, PUBLIC_KEY }) {
  const verifyToken = createVerifier({ key: PUBLIC_KEY })

  return async function decodeTokenMiddleware (request) {
    const token = (request.headers.authorization || request.query.access_token || '').replace(/^Bearer /, '')

    if (!token) {
      return
    }

    request[name] = verifyToken(token)
  }
}

function compareToken ({ token }) {
  return async (request, reply) => {
    const foundToken = (request.headers.authorization || '').replace(/^Token /, '')

    if (!token || foundToken !== token) {
      return reply.code(401).send({
        error: 'We could not verify the provided token.'
      })
    }
  }
}

function enforceToken ({ name }) {
  return async (request, reply) => {
    if (request[name] === null) {
      return reply.code(401).send({
        error: 'An API token must be provided.'
      })
    }
  }
}

function compareOperatorOutputAndToken ({ name }) {
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
 *
 * @return {function(FastifyRequest): PromiseLike<FastifyReply>}
 */
function trackRequest ({ siteId, trackerUrl }) {
  const matomo = new MatomoTracker(siteId, trackerUrl)

  return async function trackedRequestMiddleware (request) {
    const { routerPath } = request

    try {
      const { decodedToken } = request
      // @todo track distinctively request made via direct CertificationBody API Calls
      // const ocId = decodedToken?.organismeCertificateurId ?? decodedToken?.ocId

      matomo.trackBulk([{
        ua: apiVersion,
        cvar: JSON.stringify({ decodedToken }),
        e_c: `api/v${apiMajorVersion}`,
        e_a: routerPath,
        e_n: ''
      }])
    } catch (error) {
      request.log.error('[trackedRequestMiddleware] %s - %o', error.message, error.cause)
    }
  }
}

module.exports = {
  compareOperatorOutputAndToken,
  compareToken,
  decodeToken,
  decodeTokenWithPK,
  enforceToken,
  trackRequest
}
