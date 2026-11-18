import { createVerifier, TokenError } from 'fast-jwt'
import type { FastifyRequest, FastifyReply, onRequestHookHandler, preSerializationHookHandler } from 'fastify'
import { CertificationState, recordIdSchema } from '@agencebio/cartobio-types'
import type {
  AgenceBioNormalizedOperator,
  CartoBioUser,
  NormalizedRecord,
  OrganismeCertificateur
} from '@agencebio/cartobio-types'
import { checkOcToken, fetchOperatorByNumeroBio, fetchUserOperators } from '../clients/agence-bio.client.js'
import {
  BadGatewayApiError,
  ExpiredCredentialsApiError,
  ForbiddenApiError,
  InvalidCredentialsApiError,
  NotFoundApiError,
  PreconditionFailedApiError,
  UnauthorizedApiError,
  getResponseStatusCode
} from './errors.js'
import { hasRecordForOc } from './parcellaires/parcellaires.repository.js'
import { maskOcAgents } from './outputs/history.js'
import { redactAuditNotes } from './outputs/record.js'
import { getCachedUserProfile, isRevoked } from '../modules/auth/auth.service.js'
import { userTokenSchema } from '../modules/auth/auth.tokens.js'
import {
  isAdmin,
  isOc,
  isOcAudit,
  isOcCertif,
  isOperatorUser,
  requiresOrganismeCertificateur
} from '../modules/auth/auth.utils.js'
import config from '../config/env.js'

type RequestHook = (request: FastifyRequest) => Promise<void>
type RecordQuery = (id: string, user?: CartoBioUser | null) => Promise<NormalizedRecord | null>
type RecordPatch = {
  [field: string]: unknown
  certification_state?: unknown
  properties?: Record<string, unknown>
  features?: Array<{ id?: unknown; properties?: Record<string, unknown>; geometry?: unknown }>
  feature?: { properties?: Record<string, unknown> }
  from?: unknown
  geometry?: unknown
}

const apiVersion = config.get('version')

const ACCESS_DENIED = "vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants."
const PORTAL_UNREACHABLE = "Le portail d'authentification de l'Agence Bio n'a pas pu être contacté."

// ces erreurs déconnectent le front : elles viennent d'une expiration ou d'un changement de clé de signature
const tokenExpirationErrorCodes: string[] = [
  TokenError.codes.expired,
  TokenError.codes.inactive,
  TokenError.codes.invalidSignature
]

const operatorForbiddenRecordFields = [
  'audit_date',
  'audit_notes',
  'audit_demandes',
  'certification_date_debut',
  'certification_date_fin',
  'mixite'
]
const restrictedEditableFields = ['NOM', 'commentaires', 'attente_pac']
const recordFields = [
  'version_name',
  'audit_date',
  'audit_notes',
  'audit_demandes',
  'certification_state',
  'certification_date_debut',
  'certification_date_fin',
  'mixite',
  'annee_reference_controle'
]
const ocOnlyFeatureFields = ['conversion_niveau', 'engagement_date']
const requiredRoleByState = new Map<unknown, (user: CartoBioUser) => boolean>([
  [CertificationState.AUDITED, isOcAudit],
  [CertificationState.PENDING_CERTIFICATION, isOcAudit],
  [CertificationState.CERTIFIED, isOcCertif]
])

function getRequestOc(request: FastifyRequest): OrganismeCertificateur | null | undefined {
  return request.organismeCertificateur ?? request.user?.organismeCertificateur
}

function operatorHasOc(operator: AgenceBioNormalizedOperator): boolean {
  return Object.hasOwn(operator.organismeCertificateur, 'id')
}

function hasCartobioRole(user: CartoBioUser): boolean {
  return isAdmin(user) || isOperatorUser(user) || isOc(user)
}

async function assertNotRevoked(token: string): Promise<void> {
  if (await isRevoked(token)) throw new InvalidCredentialsApiError('Le token a été révoqué')
}

function decodeUserToken(key: string): onRequestHookHandler {
  const verify = createVerifier({ key: async () => key, cache: true })

  return async function decodeUserTokenMiddleware(request: FastifyRequest): Promise<void> {
    const { authorization } = request.headers
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
    if (!token) return

    let userId: number
    try {
      userId = userTokenSchema.parse(await verify(token)).id
    } catch (error) {
      if (error instanceof TokenError && tokenExpirationErrorCodes.includes(error.code)) {
        throw new ExpiredCredentialsApiError(error.code)
      }
      throw new InvalidCredentialsApiError("nous n'avons pas réussi à vérifier le jeton d'authentification.")
    }

    await assertNotRevoked(token)

    const profile = await getCachedUserProfile(userId).catch((error: unknown) => {
      if (getResponseStatusCode(error) === 404) {
        throw new InvalidCredentialsApiError("votre compte n'existe plus.", { cause: error })
      }
      throw new BadGatewayApiError(PORTAL_UNREACHABLE, { cause: error })
    })

    if (!hasCartobioRole(profile)) throw new ForbiddenApiError("votre compte n'a pas de rôle CartoBio.")
    if (requiresOrganismeCertificateur(profile) && !profile.organismeCertificateur) {
      throw new ForbiddenApiError("votre compte n'est rattaché à aucun organisme certificateur.")
    }

    request.user = profile
  }
}

function verifyAgenceBioToken(): onRequestHookHandler {
  return async function verifyAgenceBioTokenMiddleware(request: FastifyRequest): Promise<void> {
    const token = request.headers.authorization
    if (!token || token.startsWith('Bearer ')) return

    const organismeCertificateur = await checkOcToken(token).catch((error: unknown) => {
      if ([400, 401, 403, 404].includes(Number(getResponseStatusCode(error)))) {
        throw new UnauthorizedApiError("un jeton d'API Agence Bio valide est nécessaire pour accéder à ce contenu.", {
          cause: error
        })
      }
      throw new BadGatewayApiError(PORTAL_UNREACHABLE, { cause: error })
    })

    await assertNotRevoked(token)

    request.organismeCertificateur = organismeCertificateur
  }
}

function enforceAnyFastifyDecorator(names: Array<'user' | 'organismeCertificateur'> = []): onRequestHookHandler {
  return async function enforceAnyFastifyDecoratorMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!names.some((name) => Boolean(request[name]))) {
      throw new InvalidCredentialsApiError("un jeton d'API est nécessaire pour accéder à ce contenu.")
    }

    reply.header('X-Api-Version', apiVersion)
  }
}

function enforceAdminRole(): RequestHook {
  return async function enforceAdminRoleMiddleware(request: FastifyRequest): Promise<void> {
    if (!isAdmin(request.user)) throw new ForbiddenApiError(ACCESS_DENIED)
  }
}

async function loadOperator(request: FastifyRequest, numeroBio: string | number): Promise<void> {
  const { user } = request

  try {
    if (user && isOperatorUser(user)) {
      const { operators } = await fetchUserOperators(user.id)
      if (!operators.some((operator) => String(operator.numeroBio) === String(numeroBio))) {
        throw new ForbiddenApiError('Accès interdit')
      }
    }
    request.operator = await fetchOperatorByNumeroBio(String(numeroBio))
  } catch (error) {
    if (getResponseStatusCode(error) === 404) throw new NotFoundApiError('Opérateur introuvable')
    throw error
  }
}

function enforceOperator({ param }: { param: string }): RequestHook {
  return async function enforceOperatorMiddleware(request: FastifyRequest): Promise<void> {
    const numeroBio = (request.params as Record<string, string>)[param]
    if (numeroBio === undefined || !/^\d+$/.test(numeroBio)) throw new NotFoundApiError('Opérateur introuvable')

    await loadOperator(request, numeroBio)
  }
}

function wasModifiedSince(updatedAt: string | Date, ifUnmodifiedSince: string | undefined): boolean {
  if (!ifUnmodifiedSince) return false
  return new Date(ifUnmodifiedSince).getTime() < new Date(new Date(updatedAt).toUTCString()).getTime()
}

async function loadRecordAndOperator(request: FastifyRequest, id: string, queryFn: RecordQuery): Promise<void> {
  if (!recordIdSchema.safeParse(id).success) throw new NotFoundApiError('Parcellaire introuvable')
  const record = await queryFn(id, request.user)
  if (!record) throw new NotFoundApiError('Parcellaire introuvable')

  if (wasModifiedSince(record.updated_at, request.headers['if-unmodified-since'])) {
    throw new PreconditionFailedApiError('Le contenu a été modifié depuis votre dernière requête.')
  }

  await loadOperator(request, record.numerobio)

  const userOcId = request.user?.organismeCertificateur?.id
  if ((userOcId !== undefined && record.oc_id !== userOcId) || isOperatorUser(request.user)) {
    record.audit_notes = null
  }

  request.record = maskOcAgents(
    record,
    { user: request.user, ocId: getRequestOc(request)?.id },
    request.operator?.organismeCertificateur?.id
  )
}

function enforceRecordAndOperator({ queryFn, param }: { queryFn: RecordQuery; param: string }): RequestHook {
  return async function enforceRecordAndOperatorMiddleware(request: FastifyRequest): Promise<void> {
    const id = (request.params as Record<string, string>)[param]
    if (id === undefined) throw new NotFoundApiError('Parcellaire introuvable')

    await loadRecordAndOperator(request, id, queryFn)
  }
}

function touchesAuditFields(patch: RecordPatch): boolean {
  return (
    (patch.certification_state != null && patch.certification_state !== CertificationState.OPERATOR_DRAFT) ||
    operatorForbiddenRecordFields.some((field) => patch[field] != null && patch[field] !== '')
  )
}

function assertCertificationRole(user: CartoBioUser, patch: RecordPatch | undefined): void {
  if (isAdmin(user) || !patch) return

  const hasCertificationDates = [patch.certification_date_debut, patch.certification_date_fin].some(
    (date) => date != null && date !== ''
  )
  if (hasCertificationDates && !isOcCertif(user)) {
    throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier les dates de certification.")
  }

  const nextState = patch.certification_state
  if (nextState == null) return

  if (!(requiredRoleByState.get(nextState)?.(user) ?? true)) {
    throw new ForbiddenApiError("ce changement d'état de certification n'est pas autorisé.")
  }
}

function isRestrictedRecord(user: CartoBioUser, record: NormalizedRecord | null | undefined): boolean {
  if (!record || isAdmin(user)) return false
  if (isOperatorUser(user)) return record.certification_state !== CertificationState.OPERATOR_DRAFT
  return record.certification_state === CertificationState.CERTIFIED && !isOcCertif(user)
}

function assertOcOnlyProperties(
  request: FastifyRequest,
  user: CartoBioUser,
  record: NormalizedRecord | null | undefined,
  patch: RecordPatch
): void {
  if (isOc(user)) return

  const propertiesById = new Map(
    (record?.parcelles?.features ?? []).map((feature): [string, Record<string, unknown>] => [
      String(feature.id),
      feature.properties
    ])
  )
  const featureId = (request.params as Record<string, string | undefined> | undefined)?.featureId
  const fromIds = Array.isArray(patch.from) ? patch.from.map(String) : null
  const payloadFeatures = [
    { properties: patch.properties, sourceIds: featureId ? [featureId] : [] },
    ...(patch.features ?? []).map((feature) => ({
      properties: feature.properties,
      sourceIds: fromIds ?? (feature.id != null ? [String(feature.id)] : [])
    })),
    { properties: patch.feature?.properties, sourceIds: [] }
  ]

  for (const { properties, sourceIds } of payloadFeatures) {
    if (!properties) continue
    delete properties.annotations

    for (const field of ocOnlyFeatureFields) {
      const value = properties[field]
      if (value == null || value === '') continue
      if (!sourceIds.some((id) => propertiesById.get(id)?.[field] === value)) {
        throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier la conversion des parcelles.")
      }
    }
  }
}

function restrictPatch(patch: RecordPatch): void {
  if (recordFields.some((field) => patch[field] != null && patch[field] !== '')) {
    throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier les informations de ce parcellaire.")
  }

  if (patch.feature !== undefined || patch.from !== undefined) {
    throw new ForbiddenApiError("vous n'êtes pas autorisé·e à ajouter ou remplacer des parcelles sur ce parcellaire.")
  }

  if (patch.geometry !== undefined || patch.features?.some((feature) => feature.geometry !== undefined)) {
    throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier la géométrie des parcelles de ce parcellaire.")
  }

  for (const properties of [patch.properties, ...(patch.features ?? []).map((feature) => feature.properties)]) {
    if (!properties) continue
    for (const key of Object.keys(properties)) {
      if (!restrictedEditableFields.includes(key)) delete properties[key]
    }
  }
}

function haveRightToUpdate(): RequestHook {
  return async function haveRightToUpdateMiddleware(request: FastifyRequest): Promise<void> {
    const { user, record } = request
    if (!user) return

    const patch = request.body as RecordPatch | undefined
    const userOcId = user.organismeCertificateur?.id
    const isWrite = request.method !== 'GET' && request.method !== 'HEAD'

    if (isWrite && record?.oc_id != null && userOcId !== undefined && record.oc_id !== userOcId) {
      throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier ce parcellaire.")
    }

    if (isOperatorUser(user) && patch && touchesAuditFields(patch)) {
      throw new ForbiddenApiError("vous n'êtes pas autorisé·e à modifier les informations d'audit ou de certification.")
    }

    assertCertificationRole(user, patch)

    if (patch) assertOcOnlyProperties(request, user, record, patch)

    if (!isRestrictedRecord(user, record)) return

    if (request.method === 'DELETE') {
      throw new ForbiddenApiError("vous n'êtes pas autorisé·e à supprimer des données de ce parcellaire.")
    }

    if (patch) restrictPatch(patch)
  }
}

async function hasOperatorAccess(
  request: FastifyRequest,
  userOc: OrganismeCertificateur | null | undefined
): Promise<boolean> {
  const { operator, record } = request

  if (!userOc) return isAdmin(request.user) || isOperatorUser(request.user)
  if (!operator && !record) return true
  if (record?.oc_id && record.oc_id === userOc.id) return true
  // les comptes de test n'ont pas d'OC
  if (!operator || !operatorHasOc(operator)) return false

  if (operator.organismeCertificateur.id === userOc.id) {
    return operator.notifications?.etatCertification !== 'NON ENGAGEE'
  }

  // un ancien OC garde l'accès aux parcellaires qu'il a créés
  return record ? false : hasRecordForOc(operator.numeroBio, userOc.id)
}

function enforceOperatorAccess(): RequestHook {
  return async function enforceOperatorAccessMiddleware(request: FastifyRequest): Promise<void> {
    if (!(await hasOperatorAccess(request, getRequestOc(request)))) throw new UnauthorizedApiError(ACCESS_DENIED)
  }
}

function checkCertification(request: FastifyRequest): void {
  const { user, operator } = request
  if (!user || isAdmin(user)) return

  const etatCertification = operator?.notifications?.etatCertification
  const userOc = user.organismeCertificateur
  if (
    etatCertification === 'ARRETEE' ||
    etatCertification === 'RETIREE' ||
    (userOc && operator?.organismeCertificateur?.id !== userOc.id)
  ) {
    throw new UnauthorizedApiError(ACCESS_DENIED)
  }
}

function compareOperatorOutputAndToken(
  accessor: (request: FastifyRequest) => OrganismeCertificateur | null | undefined
): preSerializationHookHandler {
  return async function compareOperatorOutputAndTokenMiddleware(
    request: FastifyRequest,
    _: FastifyReply,
    payload: unknown
  ): Promise<unknown> {
    const { operator, record } = request
    const userOc = accessor(request)

    if (!(await hasOperatorAccess(request, userOc))) throw new UnauthorizedApiError(ACCESS_DENIED)

    if (!userOc || !operator || !operatorHasOc(operator)) return payload

    const isCurrentOc = operator.organismeCertificateur.id === userOc.id

    if (record && isCurrentOc && record.oc_id !== userOc.id) {
      request.record = redactAuditNotes(record)
    }

    if (!record && !isCurrentOc) {
      operator.organismeCertificateur = {}
    }

    return payload
  }
}

export {
  checkCertification,
  compareOperatorOutputAndToken,
  decodeUserToken,
  enforceAdminRole,
  enforceAnyFastifyDecorator,
  enforceOperator,
  enforceOperatorAccess,
  enforceRecordAndOperator,
  getRequestOc,
  haveRightToUpdate,
  loadRecordAndOperator,
  verifyAgenceBioToken
}
