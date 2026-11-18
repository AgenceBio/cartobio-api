import { createHash } from 'node:crypto'
import memo from 'p-memoize'
import gotModule from 'got'
const got = gotModule.default
const { get, HTTPError } = got
import { createDecoder, createVerifier } from 'fast-jwt'
import config from '../../config/env.js'
import * as repository from './auth.repository.js'
import type { DepartementRow, UserProfile } from './auth.types.js'
import { fetchOperatorByNumeroBio } from '../../clients/agence-bio.client.js'
import type { AgenceBioUserGroup, OrganismeCertificateur } from '@agencebio/cartobio-types'

const origin = config.get('notifications.origin')
const decode = createDecoder()
const verify = createVerifier({ key: config.get('notifications.publicKey') })
const oneHour = 60 * 60 * 1000

interface NotificationsDecodedToken {
  numeroBio: string
  userId: number
}

interface NotificationsUserProfile {
  id: number
  prenom: string
  nom: string
  organismeCertificateurId?: number | null
  groupes: AgenceBioUserGroup[]
}

function fetchCertificationBodies() {
  return get(`${config.get('notifications.endpoint')}/api/oc`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
  }).json<OrganismeCertificateur[]>()
}

const getCertificationBodies = memo(fetchCertificationBodies, { maxAge: 24 * oneHour })

async function getUserProfileById(userId: number): Promise<UserProfile> {
  const [userProfile, certificationBodies] = await Promise.all([
    get(`${config.get('notifications.endpoint')}/api/users/${userId}`, {
      headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
    }).json<NotificationsUserProfile>(),
    getCertificationBodies()
  ])

  return {
    id: userProfile.id,
    prenom: userProfile.prenom,
    nom: userProfile.nom,
    ...(userProfile.organismeCertificateurId
      ? { organismeCertificateur: { id: userProfile.organismeCertificateurId, nom: certificationBodies.find(({ id }) => userProfile.organismeCertificateurId === id)?.nom ?? '' } }
      : {}),
    groups: userProfile.groupes.map(({ id, nom }) => ({ id, nom })),
    mainGroup: { id: userProfile.groupes.at(0)?.id, nom: userProfile.groupes.at(0)?.nom }
  }
}

const getCachedUserProfile = memo(getUserProfileById, { maxAge: oneHour })

async function getHistoryUser(userId: string | number, userRole: string | null): Promise<UserProfile> {
  try {
    return await getCachedUserProfile(Number(userId))
  } catch (error) {
    if (error instanceof HTTPError && error.response.statusCode === 404) {
      return { id: Number(userId), nom: 'Utilisateur supprimé', prenom: '', groups: [], mainGroup: { nom: userRole } }
    }

    throw error
  }
}

async function getUserProfileFromSSOToken(accessToken: string) {
  const { sub: email }: { sub: string } = decode(accessToken)
  const userProfile = await get(`${config.get('notifications.endpoint')}/api/utilisateur/by-email`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }, searchParams: { email }
  }).json<{ id: number }>()
  return getUserProfileById(userProfile.id)
}

function verifyNotificationAuthorization(authorizationHeader: string | undefined): { decodedToken: NotificationsDecodedToken; token: string; error?: undefined } | { error: unknown; decodedToken?: undefined; token?: undefined } {
  const token = (authorizationHeader ?? '').replace(/Bearer /i, '')
  try {
    return { decodedToken: verify(token) as NotificationsDecodedToken, token }
  } catch (error) {
    return { error }
  }
}

async function getDepartement() {
  const rows = await repository.findDepartements()
  const grouped = rows.reduce<Record<string, DepartementRow[]>>((regions, row) => {
    regions[row.nomRegion] ??= []
    regions[row.nomRegion].push(row)
    return regions
  }, {})
  return Object.fromEntries(Object.keys(grouped).sort().map(region => [region, grouped[region].map(({ code, nom }) => ({ code, nom })).sort((a, b) => a.nom.localeCompare(b.nom))]))
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

async function revokeToken(token: string, exp: number): Promise<void> {
  if (exp - Math.floor(Date.now() / 1000) <= 0) return
  await repository.insertRevokedToken(hashToken(token), exp)
}

function isRevoked(token: string) {
  return repository.hasRevokedToken(hashToken(token))
}

export {
  verifyNotificationAuthorization,
  fetchOperatorByNumeroBio,
  getUserProfileById,
  getHistoryUser,
  getUserProfileFromSSOToken,
  getDepartement,
  revokeToken,
  isRevoked
}
