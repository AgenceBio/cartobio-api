'use strict'

const { createVerifier, TokenError } = require('fast-jwt')
const Sentry = require('@sentry/node')

// @ts-ignore
const { version: apiVersion } = require('../package.json')
const { checkOcToken } = require('./providers/agence-bio.js')
const { ExpiredCredentialsApiError, InvalidCredentialsApiError, NotFoundApiError, UnauthorizedApiError } = require('./errors.js')
const { fetchOperatorByNumeroBio } = require('./providers/agence-bio')
const { BadGatewayApiError, PreconditionFailedApiError } = require('./errors')
const { getRecords } = require('./providers/cartobio')
/**
 * @typedef {import('fast-jwt').TokenValidationErrorCode} TokenValidationErrorCode
 * @typedef {import('fastify').FastifyRequest} FastifyRequest
 * @typedef {import('fastify').FastifyReply} FastifyReply
 * @typedef {import('fastify').onRequestHookHandler} onRequestHookHandler
 * @typedef {import('fastify').preValidationHookHandler} preValidationHookHandler
 * @typedef {import('fastify').preSerializationHookHandler} preSerializationHookHandler
 * @typedef {import('./providers/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('./providers/types/cartobio').CartoBioOCUser} CartoBioOCUser
 * @typedef {import('./providers/cartobio').OrganismeCertificateur} OrganismeCertificateur
 */

/**
 * @enum {TokenValidationErrorCode}
 * @see https://github.com/nearform/fast-jwt/blob/master/src/error.js
 */
const tokenExpirationErrorCodes = [
  TokenError.codes.expired,
  TokenError.codes.inactive,
  TokenError.codes.invalidSignature
]

/**
 * @param {{keys: String[]}} params - keys property on the token
 * @return {onRequestHookHandler}
 */
function decodeUserToken ({ keys }) {
  // fast-jwt documentation states that
  // > When enabled (…) performances dramatically improve.
  // So we enable cache.
  const verifiers = keys.map(key => createVerifier({ key: async () => key, cache: true }))

  /**
   * @param {FastifyRequest} request
   */
  return async function decodeTokenMiddleware (request) {
    let token = ''

    // @ts-ignore
    if (request.headers.authorization?.startsWith('Bearer ')) {
      token = request.headers.authorization.replace(/^Bearer /, '').trim()
      // @ts-ignore
    } else if (request.query.access_token) {
      // @ts-ignore
      token = request.query.access_token
    }

    if (!token) {
      return
    }

    // We cycle through various verification methods until one succeeds
    // For example, a Bearer emitted by CartoBio could fail
    // whereas a Notification token via Public Key could be okay
    /**
     * @type {{user: CartoBioOCUser?, error: TokenError?}} result
     */
    const { user, error } = await Promise
      .allSettled(verifiers.map(fn => fn(token)))
      .then(results => ({
        // @ts-ignore
        user: results.find(({ status }) => status === 'fulfilled')?.value,
        // @ts-ignore
        error: results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason).at(0)
      }))

    // these errors will trigger a frontend disconnection
    // because they are bound to a signature change, or an expiry
    // @ts-ignore
    if (!user && tokenExpirationErrorCodes.includes(error?.code)) {
      throw new ExpiredCredentialsApiError(error.code)
    }

    // any other error is not tight to a server/time based setting
    if (!user && error) {
      throw new InvalidCredentialsApiError("nous n'avons pas réussi à vérifier le jeton d'authentification.")
    }

    Sentry.setUser({ id: user?.id })
    request.user = user
  }
}

/**
 * @param {String[]} names - property keys which must be set on the request
 * @return {onRequestHookHandler}
 */
function enforceAnyFastifyDecorator (names = []) {
  /**
   * @param {FastifyRequest} request
   * @param {FastifyReply} reply
   */
  return async function enforceAnyFastifyDecoratorMiddleware (request, reply) {
    const isFound = names.some((decoratorName) => {
      return Object.hasOwn(request, decoratorName) && request[decoratorName]
    })

    if (isFound === false) {
      throw new InvalidCredentialsApiError("un jeton d'API est nécessaire pour accéder à ce contenu.")
    }

    reply.header('X-Api-Version', apiVersion)
  }
}

/**
 * Verify an Agence Bio provided token.
 * The header might already be populated, but it is not for us if it starts with 'Bearer'
 *
 * @returns {onRequestHookHandler}
 */
function verifyAgenceBioToken () {
  /**
   * @param {FastifyRequest} request
   */
  return async function verifyAgenceBioTokenMiddleware (request) {
    const foundToken = request.headers.authorization || ''

    if (foundToken && !foundToken.startsWith('Bearer ')) {
      try {
        request.organismeCertificateur = await checkOcToken(foundToken)
      } catch (error) {
        if (error.code) {
          throw new UnauthorizedApiError("un jeton d'API Agence Bio valide est nécessaire pour accéder à ce contenu.", { cause: error })
        } else {
          throw new BadGatewayApiError('Le portail d\'authentification de l\'Agence Bio n\'a pas pu être contacté.', { cause: error })
        }
      }
    }
  }
}

function enforceOperator ({ param }) {
  /**
   * @param {FastifyRequest} request
   */
  return async function enforceOperatorMiddleware (request) {
    const numeroBio = request.params[param]

    try {
      request.operator = await fetchOperatorByNumeroBio(numeroBio)
    } catch (error) {
      if (error?.response?.statusCode === 404) {
        throw new NotFoundApiError('Opérateur introuvable')
      }

      throw error
    }
  }
}

/**
 * Ensure a valid record can be fetched
 * @param {{ queryFn: Function, param: String }} options - Function to call, with a given Request param as its first argument
 * @returns {preValidationHookHandler}
 */
function enforceRecord ({ queryFn, param }) {
  /**
   * @param {FastifyRequest} request
   */
  return async function enforceRecordMiddleware (request) {
    const id = request.params[param]
    const record = await queryFn(id)
    if (!record) {
      throw new NotFoundApiError('Parcellaire introuvable')
    }

    if (request.headers['if-unmodified-since'] &&
      new Date(request.headers['if-unmodified-since']).getTime() < new Date(record.updated_at.toUTCString()).getTime()) {
      throw new PreconditionFailedApiError('Le contenu a été modifié depuis votre dernière requête.')
    }

    // Finally, assign the fetched record to forthcoming hooks
    request.record = record
  }
}

/**
 * Ensure a valid record can be fetched
 * @param {{ queryFn: Function, param: String }} options - Function to call, with a given Request param as its first argument
 * @returns {preValidationHookHandler}
 */
function enforceRecordAndOperator ({ queryFn, param }) {
  /**
   * @param {FastifyRequest} request
   */
  return async function enforceRecordAndOperatorMiddleware (request) {
    const id = request.params[param]
    const record = await queryFn(id)

    if (!record) {
      throw new NotFoundApiError('Parcellaire introuvable')
    }

    if (request.headers['if-unmodified-since'] &&
      new Date(request.headers['if-unmodified-since']).getTime() < new Date(record.updated_at.toUTCString()).getTime()) {
      throw new PreconditionFailedApiError('Le contenu a été modifié depuis votre dernière requête.')
    }

    // Finally, assign the fetched record to forthcoming hooks

    const numeroBio = record.numerobio

    try {
      request.operator = await fetchOperatorByNumeroBio(numeroBio)
    } catch (error) {
      if (error?.response?.statusCode === 404) {
        throw new NotFoundApiError('Opérateur introuvable')
      }

      throw error
    }

    // Record was created by another OC therefore, remove field current OC should not have access
    // @ts-ignore
    if (request.operator && record && request.user.organismeCertificateur && record.oc_id !== request.user.organismeCertificateur.id) {
      record.oc_id = null
      record.audit_notes = null
    }

    request.record = record
  }
}

/**
 * Compares if the upcoming output organismeCertificateur.id matches the user-provided organismeCertificateur.id
 * If it does not work, it prevents the reply to be sent.
 *
 * We should check when:
 * - when an operator is set
 * - when a record is set
 *
 * We can skip if:
 * - an operator is set, without OC (mostly test accounts)
 *
 * @param {(request: FastifyRequest) => OrganismeCertificateur|undefined} accessor
 * @returns {preSerializationHookHandler}
 */
function compareOperatorOutputAndToken (accessor) {
  /**
   * @param {FastifyRequest} request
   * @param {FastifyReply} _
   * @param {any} payload
   */
  return async function compareOperatorOutputAndTokenMiddleware (request, _, payload) {
    const { operator, record } = request
    // userOC can be empty if a route has two credentials check
    const userOc = accessor(request)

    if (!userOc || (!operator && !record)) {
      return payload
    }

    // we work on an operator
    // test accounts do not have an OC id, thus we allow their access
    // @ts-ignore
    if (operator && Object.hasOwn(operator.organismeCertificateur, 'id') && userOc && userOc.id === operator.organismeCertificateur.id) {
      // readonly record
      if (record && record.oc_id !== userOc.id) {
        record.audit_notes = null
        record.audit_demandes = null
        request.record = record
      }
      return payload
    }

    // we work on an record
    if (record && record.oc_id && userOc && userOc.id === record.oc_id) {
      return payload
    }

    // we might be a previous OC
    // @ts-ignore
    if (!record && operator && Object.hasOwn(operator.organismeCertificateur, 'id') && userOc && userOc.id !== operator.organismeCertificateur.id) {
      const records = await getRecords(operator.numeroBio)

      if (records.some((r) => r.oc_id === userOc.id)) {
        operator.organismeCertificateur = {}
        request.operator = operator
        // record.oc_id = null
        // record.audit_notes = null
        // request.record = record

        return payload
      }
    }

    throw new UnauthorizedApiError("vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
  }
}

function checkCertification (request, reply) {
  const array = request.operator?.certificats ?? request.operator?.notifications ?? []
  console.log(request.user, request.operator, request.user.organismeCertificateur)
  let currentStatut
  for (const notif of array) {
    currentStatut = notif.etatCertification || notif.status
    if (currentStatut !== 'BROUILLON') {
      continue
    }
  }

  if (!(currentStatut !== 'ARRETEE' && request.user.organismeCertificateur ? request.user?.organismeCertificateur === request.operator?.organismeCertificateur : true)) {
    throw new UnauthorizedApiError("vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
  }
}

module.exports = {
  compareOperatorOutputAndToken,
  decodeUserToken,
  enforceAnyFastifyDecorator,
  enforceOperator,
  enforceRecord,
  enforceRecordAndOperator,
  verifyAgenceBioToken,
  checkCertification
}
