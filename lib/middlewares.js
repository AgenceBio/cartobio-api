'use strict'

const { createVerifier } = require('fast-jwt')
const MatomoTracker = require('matomo-tracker')
const { version: apiVersion } = require('../package.json')
const apiMajorVersion = apiVersion.split('.')[0]

/**
 * @typedef {import('fastify').FastifyRequest} FastifyRequest
 * @typedef {import('fastify').FastifyReply} FastifyReply
 */

function decodeToken ({ name, keys }) {
  // fast-jwt documentation states that
  // > When enabled (…) performances dramatically improve.
  // So we enable cache.
  const verifiers = keys.map(key => createVerifier({ key: async () => key, cache: true }))

  return async function decodeTokenMiddleware (request, reply) {
    const token = (request.headers.authorization || request.query.access_token || '').replace(/^Bearer /, '')

    if (!token) {
      return
    }

    try {
      reply.header('X-Api-Version', apiVersion)

      // We cycle through various verification methods until one succeeds
      // For example, a Bearer emitted by CartoBio could fail
      // whereas a Notification token via Public Key could be okay
      request[name] = await Promise
        .allSettled(verifiers.map(fn => fn(token)))
        .then(results => results.find(({ status }) => status === 'fulfilled')?.value)

      return
    } catch (error) {
      return reply.code(401).send({
        error: 'We could not verify the provided token.'
      })
    }
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
  enforceToken,
  trackRequest
}
