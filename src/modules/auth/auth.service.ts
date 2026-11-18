import { createHash, randomBytes } from 'node:crypto'
import memo from 'p-memoize'
import ExpiryMap from 'expiry-map'
import got, { HTTPError } from 'got'
const { get } = got
import { createDecoder, createSigner, createVerifier } from 'fast-jwt'
import config from '../../config/env.js'
import { logger } from '../../config/logger.js'
import * as repository from './auth.repository.js'
import { accessTokenSchema, notificationsTokenSchema, ssoAccessTokenSchema } from './auth.tokens.js'
import type { AccessToken, RefreshedSession } from './auth.types.js'
import { InvalidCredentialsApiError } from '../../shared/errors.js'
import { fetchUserOperators } from '../../clients/agence-bio.client.js'
import { organismeCertificateurSchema } from '@agencebio/cartobio-types'
import type { AgenceBioNormalizedOperator, CartoBioUser, OrganismeCertificateur } from '@agencebio/cartobio-types'
import { agenceBioUserByEmailSchema, agenceBioUserProfileSchema } from '../../clients/agence-bio.types.js'
import { parseApiResponse } from '../../clients/clients.utils.js'
import { HTTP_TIMEOUT } from '../../clients/clients.utils.js'
import { z } from 'zod'
import { isAdmin, isOperatorUser } from './auth.utils.js'

const origin = config.get('notifications.origin')
const decode = createDecoder()
const verify = createVerifier({ key: config.get('notifications.publicKey'), requiredClaims: ['exp'] })
const oneHour = 60 * 60 * 1000

const TOKEN_ISSUER = 'cartobio'
const ACCESS_TOKEN_DURATION = 15 * 60 * 1000
const EXCHANGE_TOKEN_DURATION = 2 * oneHour
const SESSION_IDLE_DURATION = 7 * 24 * oneHour
const SESSION_MAX_DURATION = 30 * 24 * oneHour
const ROTATION_GRACE_DURATION = 30 * 1000

const signerOptions = {
  key: config.get('jwtSecret'),
  algorithm: 'HS256',
  iss: TOKEN_ISSUER,
  aud: TOKEN_ISSUER
} as const
const signToken = createSigner({ ...signerOptions, expiresIn: ACCESS_TOKEN_DURATION })
const signExchange = createSigner({ ...signerOptions, expiresIn: EXCHANGE_TOKEN_DURATION })
const verifyToken = createVerifier({
  key: config.get('jwtSecret'),
  algorithms: ['HS256'],
  allowedIss: TOKEN_ISSUER,
  allowedAud: TOKEN_ISSUER,
  requiredClaims: ['iss', 'aud', 'exp', 'sub', 'typ'],
  cache: true
})

type NotificationsDecodedToken = z.infer<typeof notificationsTokenSchema>

async function fetchCertificationBodies(): Promise<OrganismeCertificateur[]> {
  return parseApiResponse(
    z.array(organismeCertificateurSchema),
    await get(`${config.get('notifications.endpoint')}/api/oc`, {
      timeout: HTTP_TIMEOUT,

      headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
    }).json(),
    "l'API Agence Bio"
  )
}

const getCertificationBodies = memo(fetchCertificationBodies, {
  cache: new ExpiryMap(24 * oneHour)
})

export async function getUserProfileById(userId: number): Promise<CartoBioUser> {
  const [userProfile, certificationBodies] = await Promise.all([
    get(`${config.get('notifications.endpoint')}/api/users/${userId}`, {
      timeout: HTTP_TIMEOUT,

      headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
    })
      .json()
      .then((data) => parseApiResponse(agenceBioUserProfileSchema, data, "l'API Agence Bio")),
    getCertificationBodies()
  ])

  const profile: CartoBioUser = {
    id: userProfile.id,
    prenom: userProfile.prenom ?? '',
    nom: userProfile.nom ?? '',
    groups: userProfile.groupes.map(({ id, nom }) => ({ id, nom })),
    mainGroup: { id: userProfile.groupes.at(0)?.id, nom: userProfile.groupes.at(0)?.nom }
  }

  if (!userProfile.organismeCertificateurId || isAdmin(profile)) return profile

  return {
    ...profile,
    organismeCertificateur: {
      id: userProfile.organismeCertificateurId,
      nom: certificationBodies.find(({ id }) => userProfile.organismeCertificateurId === id)?.nom ?? ''
    }
  }
}

export const getCachedUserProfile = memo(getUserProfileById, { cache: new ExpiryMap(5 * 60 * 1000) })

export async function getHistoryUser(userId: string | number, userRole: string | null): Promise<CartoBioUser> {
  try {
    return await getCachedUserProfile(Number(userId))
  } catch (error) {
    if (error instanceof HTTPError && error.response.statusCode === 404) {
      return {
        id: Number(userId),
        nom: 'Utilisateur supprimé',
        prenom: '',
        groups: [],
        mainGroup: { nom: userRole }
      }
    }

    logger.warn({ err: error, userId }, "Profil de l'historique indisponible")
    return {
      id: Number(userId),
      nom: 'Utilisateur inconnu',
      prenom: '',
      groups: [],
      mainGroup: { nom: userRole }
    }
  }
}

export async function getUserProfileFromSSOToken(accessToken: string): Promise<CartoBioUser> {
  const { sub: email } = ssoAccessTokenSchema.parse(decode(accessToken))
  const userProfile = parseApiResponse(
    agenceBioUserByEmailSchema,
    await get(`${config.get('notifications.endpoint')}/api/utilisateur/by-email`, {
      timeout: HTTP_TIMEOUT,

      headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin },
      searchParams: { email }
    }).json(),
    "l'API Agence Bio"
  )
  return getUserProfileById(userProfile.id)
}

export function verifyNotificationAuthorization(
  authorizationHeader: string | undefined
):
  | { decodedToken: NotificationsDecodedToken; token: string; error?: undefined }
  | { error: unknown; decodedToken?: undefined; token?: undefined } {
  const token = (authorizationHeader ?? '').replace(/Bearer /i, '')
  try {
    return { decodedToken: notificationsTokenSchema.parse(verify(token)), token }
  } catch (error) {
    return { error }
  }
}

export async function canAccessOperator(user: CartoBioUser, operator: AgenceBioNormalizedOperator): Promise<boolean> {
  if (isAdmin(user)) return true
  if (isOperatorUser(user)) {
    const { operators } = await fetchUserOperators(user.id)
    return operators.some(({ numeroBio }) => String(numeroBio) === String(operator.numeroBio))
  }
  const ocId = user.organismeCertificateur?.id
  return ocId !== undefined && 'id' in operator.organismeCertificateur && operator.organismeCertificateur.id === ocId
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
const newRefreshToken = (): string => randomBytes(32).toString('base64url')

export function signAccessToken(userId: number): string {
  return signToken({ sub: String(userId), typ: 'session' })
}

export function signExchangeToken(userId: number, numeroBio: string): string {
  return signExchange({ sub: String(userId), typ: 'exchange', numeroBio })
}

export function verifyAccessToken(token: string): AccessToken {
  return accessTokenSchema.parse(verifyToken(token))
}

export async function createSession(
  userId: number,
  idToken: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = newRefreshToken()
  const expiresAt = new Date(Date.now() + SESSION_IDLE_DURATION)
  await repository.insertSession({ userId, tokenHash: hashToken(token), idToken, expiresAt })
  return { token, expiresAt }
}

export async function refreshSession(token: string): Promise<RefreshedSession> {
  const tokenHash = hashToken(token)
  const session = await repository.findSessionByTokenHash(tokenHash)
  if (!session) throw new InvalidCredentialsApiError('session inconnue, veuillez vous reconnecter.')

  const now = Date.now()
  if (session.expiresAt.getTime() <= now) {
    await repository.deleteSession(session.id)
    throw new InvalidCredentialsApiError('session expirée, veuillez vous reconnecter.')
  }

  if (session.previousTokenHash === tokenHash) {
    if (now - session.rotatedAt.getTime() <= ROTATION_GRACE_DURATION) return { userId: session.userId }
    await repository.deleteSession(session.id)
    logger.warn({ userId: session.userId }, "Réutilisation d'un jeton de session, session révoquée")
    throw new InvalidCredentialsApiError('session révoquée, veuillez vous reconnecter.')
  }

  const nextToken = newRefreshToken()
  const expiresAt = new Date(Math.min(now + SESSION_IDLE_DURATION, session.createdAt.getTime() + SESSION_MAX_DURATION))
  const rotated = await repository.rotateSession(session.id, tokenHash, {
    tokenHash: hashToken(nextToken),
    previousTokenHash: tokenHash,
    rotatedAt: new Date(now),
    expiresAt
  })
  if (!rotated) return { userId: session.userId }

  return { userId: session.userId, token: nextToken, expiresAt }
}

export async function endSession(token: string): Promise<string | null> {
  const session = await repository.findSessionByTokenHash(hashToken(token))
  if (!session) return null
  await repository.deleteSession(session.id)
  return session.idToken
}
