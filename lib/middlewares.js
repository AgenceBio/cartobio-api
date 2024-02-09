'use strict'

const { createVerifier } = require('fast-jwt')
const Sentry = require('@sentry/node')

// @ts-ignore
const { version: apiVersion } = require('../package.json')
const { checkOcToken } = require('./providers/agence-bio.js')
const { UnauthorizedApiError, InvalidRequestApiError, NotFoundApiError } = require('./errors.js')
/**
 * @typedef {import('fastify').FastifyRequest} FastifyRequest
 * @typedef {import('fastify').FastifyReply} FastifyReply
 * @typedef {import('fastify').onRequestHookHandler} onRequestHookHandler
 * @typedef {import('fastify').preValidationHookHandler} preValidationHookHandler
 * @typedef {import('fastify').preSerializationHookHandler} preSerializationHookHandler
 * @typedef {import('./providers/cartobio').CartoBioUser} CartoBioUser
 */

/**
 * @param {{keys: String[]}} params - keys property on the token
 * @return {onRequestHookHandler}
 */
function decodeUserToken ({ keys }) {
  // fast-jwt documentation states that
  // > When enabled (…) performances dramatically improve.
  // So we enable cache.
  const verifiers = keys.map(key => createVerifier({ key: async () => key, cache: true }))

  return async function decodeTokenMiddleware (request, reply) {
    // @ts-ignore
    const token = (request.headers.authorization || request.query.access_token || '').replace(/^Bearer /, '')

    if (!token) {
      return
    }

    try {
      reply.header('X-Api-Version', apiVersion)

      // We cycle through various verification methods until one succeeds
      // For example, a Bearer emitted by CartoBio could fail
      // whereas a Notification token via Public Key could be okay
      /**
       * @type {CartoBioUser}
       */
      const user = await Promise
        .allSettled(verifiers.map(fn => fn(token)))
        // @ts-ignore
        .then(results => results.find(({ status }) => status === 'fulfilled')?.value)
      Sentry.setUser({ id: user?.id })

      // @ts-ignore
      request.user = user
    } catch (error) {
      throw new UnauthorizedApiError("Nous n'avons pas réussi à vérifier le jeton d'authentification fourni.")
    }
  }
}

/**
 * @param token
 * @return {onRequestHookHandler}
 */
function compareToken ({ token }) {
  return async function compareTokenMiddleware (request) {
    const foundToken = (request.headers.authorization || '').replace(/^Token /, '')

    if (!token || foundToken !== token) {
      throw new UnauthorizedApiError("Nous n'avons pas réussi à vérifier le jeton d'authentification fourni.")
    }
  }
}

/**
 * @param {String[]} names - property keys which must be set on the request
 * @return {onRequestHookHandler}
 */
function enforceAnyFastifyDecorator (names = []) {
  return async function enforceAnyFastifyDecoratorMiddleware (request) {
    const isFound = names.some((decoratorName) => {
      return Object.hasOwn(request, decoratorName) && request[decoratorName]
    })

    if (isFound === false) {
      throw new UnauthorizedApiError("Un jeton d'API est nécessaire pour accéder à ce contenu.")
    }
  }
}

/**
 * Verify an Agence Bio provided token.
 * The header might already be populated, but it is not for us if it starts with 'Bearer'
 *
 * @returns {onRequestHookHandler}
 */
function verifyAgenceBioToken () {
  return async function verifyAgenceBioTokenMiddleware (request) {
    const foundToken = request.headers.authorization || ''

    if (foundToken && !foundToken.startsWith('Bearer ')) {
      try {
        // @ts-ignore
        request.organismeCertificateur = await checkOcToken(foundToken)
      } catch (error) {
        if (error.code) {
          throw new UnauthorizedApiError("Un jeton d'API Agence Bio valide est nécessaire pour accéder à ce contenu.", error)
        } else {
          throw new InvalidRequestApiError('Erreur inconnue', error)
        }
      }
    }
  }
}

/**
 * Ensure a valid record can be fetched
 * @param {{ queryFn: Function, param: String }} options - Function to call, with a given Request param as its first argument
 * @returns {preValidationHookHandler}
 */
function enforceRecord ({ queryFn, param }) {
  return async function enforceRecordMiddleware (request) {
    const id = request.params[param]
    const record = await queryFn(id)

    if (!record) {
      throw new NotFoundApiError('Parcellaire introuvable')
    }

    // Finally, assign the fetched record to forthcoming hooks
    // @ts-ignore
    request.record = record
  }
}

/**
 * Compares if the upcoming output organismeCertificateur.id matches the user-provided organismeCertificateur.id
 * If it does not work, it prevents the reply to be sent.
 *
 * TODO: because we now fetch the OperatorRecord prior to running the route,
 * we could move this logic ahead of the Request Lifecycle.
 *
 * @param {{ name: String }} options
 * @returns {preSerializationHookHandler}
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
  decodeUserToken,
  enforceAnyFastifyDecorator,
  enforceRecord,
  verifyAgenceBioToken
}
