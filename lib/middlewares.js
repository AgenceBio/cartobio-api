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
        error: 'Nous n\'avons pas réussi à vérifier le jeton d\'authentification fourni.'
      })
    }
  }
}

function compareToken ({ token }) {
  return async function compareTokenMiddleware (request, reply) {
    const foundToken = (request.headers.authorization || '').replace(/^Token /, '')

    if (!token || foundToken !== token) {
      return reply.code(401).send({
        error: 'Nous n\'avons pas réussi à vérifier le jeton d\'authentification fourni.'
      })
    }
  }
}

function enforceToken ({ name }) {
  return async function enforceTokenMiddleware (request, reply) {
    if (!request[name]) {
      return reply.code(401).send({
        error: 'Un jeton d\'API est nécessaire pour accéder à ce contenu.'
      })
    }
  }
}

function enforceRecord ({ queryFn, fieldId }) {
  return async function enforceRecordMiddleware (request, reply) {
    const id = request.params[fieldId]
    const record = await queryFn(id)

    if (!record) {
      return reply.code(404).send({
        error: 'Parcellaire introuvable'
      })
    }

    // Finally, assign the fetched record to forthcoming hooks
    request.record = record
  }
}

function compareOperatorOutputAndToken ({ name }) {
  return async (request, reply, payload) => {
    const { operator } = payload ?? {}
    const { organismeCertificateur } = operator ?? {}
    const { organismeCertificateurId: expectedOcId } = request[name] ?? {}

    if (organismeCertificateur && expectedOcId && expectedOcId !== organismeCertificateur.id) {
      return reply.code(403).send({
        error: 'Vous n\'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.'
      })
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
  enforceRecord,
  enforceToken,
  trackRequest
}
