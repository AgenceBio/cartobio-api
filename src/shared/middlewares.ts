import { createVerifier, TokenError } from 'fast-jwt'

import { checkOcToken, fetchUserOperators } from '../clients/agence-bio.client.js'
import { ExpiredCredentialsApiError, InvalidCredentialsApiError, NotFoundApiError, UnauthorizedApiError, ForbiddenApiError } from './errors.js'
import { fetchOperatorByNumeroBio } from '../clients/agence-bio.client.js'
import { BadGatewayApiError, PreconditionFailedApiError, getErrorCode, getResponseStatusCode } from './errors.js'
import { getRecords } from './parcellaires/parcellaires.service.js'
import { isRevoked } from '../modules/auth/auth.service.js'
import { userTokenSchema } from '../modules/auth/auth.tokens.js'
import type { FastifyRequest, FastifyReply, onRequestHookHandler, preSerializationHookHandler } from 'fastify'
import type { CartoBioUser, NormalizedRecord, OrganismeCertificateur } from '@agencebio/cartobio-types'
import config from '../config/env.js'

const apiVersion = config.get('version')

/**
 * @see https://github.com/nearform/fast-jwt/blob/master/src/error.js
 */
const tokenExpirationErrorCodes: string[] = [
  TokenError.codes.expired,
  TokenError.codes.inactive,
  TokenError.codes.invalidSignature
]

function decodeUserToken ({ keys }: { keys: string[] }): onRequestHookHandler {
  const verifiers = keys.map(key => createVerifier({ key: async () => key, cache: true }))

  return async function decodeTokenMiddleware (request: FastifyRequest): Promise<void> {
    let token = ''

    if (request.headers.authorization?.startsWith('Bearer ')) {
      token = request.headers.authorization.replace(/^Bearer /, '').trim()
    }
    // else if (request.query.access_token) {
    //       token = request.query.access_token
    // }

    if (!token) {
      return
    }

    // We cycle through various verification methods until one succeeds
    // For example, a Bearer emitted by CartoBio could fail
    // whereas a Notification token via Public Key could be okay
    const { user, error } = await Promise
      .allSettled(verifiers.map(async (fn): Promise<CartoBioUser> => userTokenSchema.parse(await fn(token)) as CartoBioUser))
      .then(results => ({
        user: results.find((result): result is PromiseFulfilledResult<CartoBioUser> => result.status === 'fulfilled')?.value,
        error: results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason as TokenError | undefined
      }))

    // these errors will trigger a frontend disconnection
    // because they are bound to a signature change, or an expiry
    if (!user && error && tokenExpirationErrorCodes.includes(error.code)) {
      throw new ExpiredCredentialsApiError(error.code)
    }

    // any other error is not tight to a server/time based setting
    if (!user && error) {
      throw new InvalidCredentialsApiError("nous n'avons pas réussi à vérifier le jeton d'authentification.")
    }

    if (user && await isRevoked(token)) {
      throw new InvalidCredentialsApiError('Le token a été révoqué')
    }

    request.user = user ?? null
  }
}

function enforceAnyFastifyDecorator (names: Array<'user' | 'organismeCertificateur'> = []): onRequestHookHandler {
  return async function enforceAnyFastifyDecoratorMiddleware (request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
 */
function verifyAgenceBioToken (): onRequestHookHandler {
  return async function verifyAgenceBioTokenMiddleware (request: FastifyRequest): Promise<void> {
    const foundToken = request.headers.authorization || ''

    if (foundToken && !foundToken.startsWith('Bearer ')) {
      try {
        request.organismeCertificateur = await checkOcToken(foundToken)
        if (await isRevoked(foundToken)) {
          throw new InvalidCredentialsApiError('Le token a été révoqué')
        }
      } catch (error) {
        if (getErrorCode(error)) {
          throw new UnauthorizedApiError("un jeton d'API Agence Bio valide est nécessaire pour accéder à ce contenu.", { cause: error })
        } else {
          throw new BadGatewayApiError('Le portail d\'authentification de l\'Agence Bio n\'a pas pu être contacté.', { cause: error })
        }
      }
    }
  }
}

function enforceOperator ({ param }: { param: string }) {
  return async function enforceOperatorMiddleware (request: FastifyRequest): Promise<void> {
    const numeroBio = (request.params as Record<string, string>)[param]
    if (numeroBio === undefined) throw new NotFoundApiError('Opérateur introuvable')
    const { user } = request

    try {
      if (user !== null && String(user.mainGroup.id) === '4') {
        const op = (await fetchUserOperators(user.id)).operators.find(e => String(e.numeroBio) === numeroBio)
        if (!op) {
          throw new ForbiddenApiError('Accès interdit')
        }
        request.operator = await fetchOperatorByNumeroBio(numeroBio)
      } else {
        request.operator = await fetchOperatorByNumeroBio(numeroBio)
      }
    } catch (error) {
      if (getResponseStatusCode(error) === 404) {
        throw new NotFoundApiError('Opérateur introuvable')
      }

      throw error
    }
  }
}

/**
 * Ensure a valid record can be fetched
 */
type RecordQuery = (id: string, user?: CartoBioUser | null) => Promise<NormalizedRecord | null>

function enforceRecordAndOperator ({ queryFn, param }: { queryFn: RecordQuery; param: string }): (request: FastifyRequest) => Promise<void> {
  return async function enforceRecordAndOperatorMiddleware (request: FastifyRequest): Promise<void> {
    const id = (request.params as Record<string, string>)[param]
    if (id === undefined) throw new NotFoundApiError('Parcellaire introuvable')
    await loadRecordAndOperator(request, id, queryFn)
  }
}

async function loadRecordAndOperator (request: FastifyRequest, id: string, queryFn: RecordQuery): Promise<void> {
  const record = await queryFn(id, request.user)

  if (!record) {
    throw new NotFoundApiError('Parcellaire introuvable')
  }

  if (request.headers['if-unmodified-since'] &&
    new Date(request.headers['if-unmodified-since']).getTime() < new Date(new Date(record.updated_at).toUTCString()).getTime()) {
    throw new PreconditionFailedApiError('Le contenu a été modifié depuis votre dernière requête.')
  }

  // Finally, assign the fetched record to forthcoming hooks

  const numeroBio = record.numerobio
  const { user } = request

  try {
    if (user && String(user.mainGroup.id) === '4') {
      const { operators } = await fetchUserOperators(user.id)
      if (!operators.some(e => String(e.numeroBio) === String(numeroBio))) {
        throw new ForbiddenApiError('Accès interdit')
      }
    }
    request.operator = await fetchOperatorByNumeroBio(numeroBio)
  } catch (error) {
    if (getResponseStatusCode(error) === 404) {
      throw new NotFoundApiError('Opérateur introuvable')
    }

    throw error
  }

  // Record was created by another OC therefore, remove field current OC should not have access
  if (request.operator && record && request.user?.organismeCertificateur && record.oc_id !== request.user.organismeCertificateur.id) {
    record.audit_notes = null
  }

  // Un opérateur n'a pas le droit de voir les audit_notes qui lui sont attribues
  if (request.operator && record && String(request.user?.mainGroup.id) === '4') {
    record.audit_notes = null
  }

  request.record = record
}

const operatorForbiddenRecordFields = ['audit_date', 'audit_notes', 'audit_demandes', 'certification_date_debut', 'certification_date_fin', 'mixite']

function haveRightToUpdate () {
  return async function haveRightToUpdateAuditMiddleware (request: FastifyRequest): Promise<void> {
    const { user, record } = request
    const patch = request.body as {
      properties?: { [s: string]: unknown }
      features?: Array<{ properties?: { [s: string]: unknown } }>
      feature?: unknown
      from?: unknown
    } & { [s: string]: unknown }

    if (!user) return

    const isOperator = String(user.mainGroup.id) === '4'

    if (isOperator && patch && (
      (patch.certification_state != null && patch.certification_state !== 'OPERATOR_DRAFT') ||
      operatorForbiddenRecordFields.some((field) => patch[field] != null && patch[field] !== '')
    )) {
      throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier les informations d'audit ou de certification.")
    }

    const isRestricted =
      (isOperator && record?.certification_state !== 'OPERATOR_DRAFT') ||
      (String(user.mainGroup.id) === '8' && record?.certification_state === 'CERTIFIED')

    if (!isRestricted || !patch) return

    if (patch.feature !== undefined || patch.from !== undefined) {
      throw new ForbiddenApiError("vous n'êtes pas autorisé·e à ajouter ou remplacer des parcelles sur ce parcellaire.")
    }

    const restrictedFields = ['NOM', 'commentaires', 'attente_pac']

    const keepRestrictedFieldsOnly = (properties: { [s: string]: unknown }): void => {
      Object.keys(properties).forEach((key): void => {
        if (!restrictedFields.includes(key)) {
          delete properties[key]
        }
      })
    }

    if (patch.properties) keepRestrictedFieldsOnly(patch.properties)
    for (const feature of patch.features ?? []) {
      if (feature.properties) keepRestrictedFieldsOnly(feature.properties)
    }
  }
}

async function hasOperatorAccess (request: FastifyRequest, userOc: OrganismeCertificateur | null | undefined): Promise<boolean> {
  const { operator, record } = request

  if (!userOc || (!operator && !record)) {
    return true
  }

  // test accounts do not have an OC id, thus we allow their access
  const operatorHasOc = Boolean(operator && Object.hasOwn(operator.organismeCertificateur, 'id'))

  if (operator && operatorHasOc && userOc.id === operator.organismeCertificateur.id &&
    (!operator.notifications || operator.notifications.etatCertification !== 'NON ENGAGEE')) {
    return true
  }

  if (record && record.oc_id && userOc.id === record.oc_id) {
    return true
  }

  // we might be a previous OC
  if (!record && operator && operatorHasOc && userOc.id !== operator.organismeCertificateur.id) {
    const records = await getRecords(operator.numeroBio)
    return records.some((r) => r.oc_id === userOc.id)
  }

  return false
}

function getRequestOc (request: FastifyRequest): OrganismeCertificateur | null | undefined {
  return request.organismeCertificateur ?? request.user?.organismeCertificateur
}

function enforceOperatorAccess () {
  return async function enforceOperatorAccessMiddleware (request: FastifyRequest): Promise<void> {
    if (!await hasOperatorAccess(request, getRequestOc(request))) {
      throw new UnauthorizedApiError("vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
    }
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
 */
function compareOperatorOutputAndToken (accessor: (request: FastifyRequest) => OrganismeCertificateur | null | undefined): preSerializationHookHandler {
  return async function compareOperatorOutputAndTokenMiddleware (request: FastifyRequest, _: FastifyReply, payload: unknown) {
    const { operator, record } = request
    // userOC can be empty if a route has two credentials check
    const userOc = accessor(request)

    if (!await hasOperatorAccess(request, userOc)) {
      throw new UnauthorizedApiError("vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
    }

    if (!userOc || !operator || !Object.hasOwn(operator.organismeCertificateur, 'id')) {
      return payload
    }

    // readonly record
    if (userOc.id === operator.organismeCertificateur.id && record && record.oc_id !== userOc.id) {
      record.audit_notes = null
      record.audit_demandes = null
      record.parcelles = {
        ...record.parcelles,
        features: record.parcelles.features.map((p) => {
          p.properties.auditeur_notes = null

          return p
        })
      }

      request.record = record
    }

    if (!record && userOc.id !== operator.organismeCertificateur.id) {
      operator.organismeCertificateur = {}
      request.operator = operator
    }

    return payload
  }
}

function checkCertification (request: FastifyRequest): void {
  if (!request.user || !request.user.organismeCertificateur) {
    return
  }

  const currentStatut = request.operator?.notifications?.etatCertification

  if (currentStatut === 'ARRETEE' || request.user.organismeCertificateur.id !== request.operator?.organismeCertificateur?.id) {
    throw new UnauthorizedApiError("vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
  }
}

function enforceAdminRole () {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!(String(request.user?.mainGroup.id) === '1')) {
      reply.code(403)
      throw new UnauthorizedApiError("vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
    }
  }
}

export {
  compareOperatorOutputAndToken,
  decodeUserToken,
  enforceAnyFastifyDecorator,
  enforceOperator,
  enforceOperatorAccess,
  enforceRecordAndOperator,
  loadRecordAndOperator,
  verifyAgenceBioToken,
  checkCertification,
  enforceAdminRole,
  haveRightToUpdate
}
