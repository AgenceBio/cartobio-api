'use strict'

const { createVerifier } = require('fast-jwt')
const { version: apiVersion } = require('../package.json')
const { UnauthorizedApiError, InvalidRequestApiError, NotFoundApiError } = require('./errors.js')

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
      throw new UnauthorizedApiError("Nous n'avons pas réussi à vérifier le jeton d'authentification fourni.")
    }
  }
}

function compareToken ({ token }) {
  return async function compareTokenMiddleware (request) {
    const foundToken = (request.headers.authorization || '').replace(/^Token /, '')

    if (!token || foundToken !== token) {
      throw new UnauthorizedApiError("Nous n'avons pas réussi à vérifier le jeton d'authentification fourni.")
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

/**
 * Ensure a valid record can be fetched
 * @param {{ queryFn: Function, param: String}} options Function to call, with a given Request param as its first argument
 * @returns {(request: FastifyRequest): Promise<OperatorRecord>}
 */
function enforceRecord ({ queryFn, param }) {
  return async function enforceRecordMiddleware (request) {
    const id = request.params[param]
    const record = await queryFn(id)

    if (!record) {
      throw new NotFoundApiError('Parcellaire introuvable')
    }

    // Finally, assign the fetched record to forthcoming hooks
    request.record = record
  }
}

/**
 * Compares if the upcoming output organismeCertificateur.id matches the token-provided organismeCertificateur.id
 * If it does not work, it prevents the reply to be sent.
 *
 * TODO: because we now fetch the OperatorRecord prior to running the route,
 * we could move this logic ahead of the Request Lifecycle.
 *
 * @param {{ name: String }} options
 * @returns {(request: FastifyRequest, reply: FastifyReply, payload=: {}): Promise<{}>}
 */
function compareOperatorOutputAndToken ({ name }) {
  return async function compareOperatorOutputAndTokenMiddleware (request, _, payload) {
    const { operator } = payload ?? {}
    const { organismeCertificateur } = operator ?? {}
    const { organismeCertificateurId: expectedOcId } = request[name] ?? {}

    if (organismeCertificateur && expectedOcId && expectedOcId !== organismeCertificateur.id) {
      throw new UnauthorizedApiError("Vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
    }

    return payload
  }
}

module.exports = {
  compareOperatorOutputAndToken,
  compareToken,
  decodeToken,
  enforceRecord,
  enforceToken
}
