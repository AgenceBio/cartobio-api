import { createHash } from 'node:crypto'
import memo from 'p-memoize'
import gotModule from 'got'
const got = gotModule.default
const { get, HTTPError } = got
import { createDecoder, createVerifier } from 'fast-jwt'
import config from '../../config/env.js'
import * as repository from './auth.repository.js'
import { notificationsTokenSchema, ssoAccessTokenSchema } from './auth.tokens.js'
import { fetchOperatorByNumeroBio } from '../../clients/agence-bio.client.js'
import { organismeCertificateurSchema } from '@agencebio/cartobio-types'
import type { CartoBioUser, OrganismeCertificateur } from '@agencebio/cartobio-types'
import { agenceBioUserByEmailSchema, agenceBioUserProfileSchema } from '../../clients/agence-bio.types.js'
import { parseApiResponse } from '../../clients/clients.utils.js'
import { z } from 'zod'

const origin = config.get('notifications.origin')
const decode = createDecoder()
const verify = createVerifier({ key: config.get('notifications.publicKey') })
const oneHour = 60 * 60 * 1000

type NotificationsDecodedToken = z.infer<typeof notificationsTokenSchema>

async function fetchCertificationBodies(): Promise<OrganismeCertificateur[]> {
  return parseApiResponse(z.array(organismeCertificateurSchema), await get(`${config.get('notifications.endpoint')}/api/oc`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
  }).json(), 'l\'API Agence Bio')
}

const getCertificationBodies = memo(fetchCertificationBodies, { maxAge: 24 * oneHour })

async function getUserProfileById(userId: number): Promise<CartoBioUser> {
  const [userProfile, certificationBodies] = await Promise.all([
    get(`${config.get('notifications.endpoint')}/api/users/${userId}`, {
      headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
    }).json().then((data) => parseApiResponse(agenceBioUserProfileSchema, data, 'l\'API Agence Bio')),
    getCertificationBodies()
  ])

  return {
    id: userProfile.id,
    prenom: userProfile.prenom ?? '',
    nom: userProfile.nom ?? '',
    ...(userProfile.organismeCertificateurId
      ? { organismeCertificateur: { id: userProfile.organismeCertificateurId, nom: certificationBodies.find(({ id }) => userProfile.organismeCertificateurId === id)?.nom ?? '' } }
      : {}),
    groups: userProfile.groupes.map(({ id, nom }) => ({ id, nom })),
    mainGroup: { id: userProfile.groupes.at(0)?.id, nom: userProfile.groupes.at(0)?.nom }
  }
}

const getCachedUserProfile = memo(getUserProfileById, { maxAge: oneHour })

async function getHistoryUser(userId: string | number, userRole: string | null): Promise<CartoBioUser> {
  try {
    return await getCachedUserProfile(Number(userId))
  } catch (error) {
    if (error instanceof HTTPError && error.response.statusCode === 404) {
      return { id: Number(userId), nom: 'Utilisateur supprimé', prenom: '', groups: [], mainGroup: { nom: userRole } }
    }

    throw error
  }
}

async function getUserProfileFromSSOToken(accessToken: string): Promise<CartoBioUser> {
  const { sub: email } = ssoAccessTokenSchema.parse(decode(accessToken))
  const userProfile = parseApiResponse(agenceBioUserByEmailSchema, await get(`${config.get('notifications.endpoint')}/api/utilisateur/by-email`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }, searchParams: { email }
  }).json(), 'l\'API Agence Bio')
  return getUserProfileById(userProfile.id)
}

function verifyNotificationAuthorization(authorizationHeader: string | undefined): { decodedToken: NotificationsDecodedToken; token: string; error?: undefined } | { error: unknown; decodedToken?: undefined; token?: undefined } {
  const token = (authorizationHeader ?? '').replace(/Bearer /i, '')
  try {
    return { decodedToken: notificationsTokenSchema.parse(verify(token)), token }
  } catch (error) {
    return { error }
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

async function revokeToken(token: string, exp: number): Promise<void> {
  if (exp - Math.floor(Date.now() / 1000) <= 0) return
  await repository.insertRevokedToken(hashToken(token), exp)
}

function isRevoked(token: string): Promise<boolean> {
  return repository.hasRevokedToken(hashToken(token))
}

export {
  verifyNotificationAuthorization,
  fetchOperatorByNumeroBio,
  getUserProfileById,
  getHistoryUser,
  getUserProfileFromSSOToken,
  revokeToken,
  isRevoked
}
