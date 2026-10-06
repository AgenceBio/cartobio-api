'use strict'

const { createHash } = require('node:crypto')
const memo = require('p-memoize')
// @ts-ignore
const { get } = require('got')
const { createDecoder, createVerifier } = require('fast-jwt')
const config = require('../../../src/config/env.js')
const repository = require('./auth.repository.js')
const { fetchOperatorByNumeroBio } = require('../../../src/clients/agence-bio.client.js')

const origin = config.get('notifications.origin')
const decode = createDecoder()
const verify = createVerifier({ key: config.get('notifications.publicKey') })
const oneHour = 60 * 60 * 1000

function fetchCertificationBodies () {
  return get(`${config.get('notifications.endpoint')}/api/oc`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
  }).json()
}

const getCertificationBodies = memo(fetchCertificationBodies, { maxAge: 24 * oneHour })

async function getUserProfileById (userId) {
  const [userProfile, certificationBodies] = await Promise.all([
    get(`${config.get('notifications.endpoint')}/api/users/${userId}`, {
      headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }
    }).json(),
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

async function getUserProfileFromSSOToken (accessToken) {
  const { sub: email } = decode(accessToken)
  const userProfile = await get(`${config.get('notifications.endpoint')}/api/utilisateur/by-email`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin: origin }, searchParams: { email }
  }).json()
  return getUserProfileById(userProfile.id)
}

function verifyNotificationAuthorization (authorizationHeader) {
  const token = authorizationHeader.replace(/Bearer /i, '')
  try {
    return { decodedToken: verify(token), token }
  } catch (error) {
    return { error }
  }
}

async function getDepartement () {
  const rows = await repository.findDepartements()
  const grouped = rows.reduce((regions, row) => {
    regions[row.nom_region] ??= []
    regions[row.nom_region].push(row)
    return regions
  }, {})
  return Object.fromEntries(Object.keys(grouped).sort().map(region => [region, grouped[region].map(({ code, nom }) => ({ code, nom })).sort((a, b) => a.nom.localeCompare(b.nom))]))
}

const hashToken = token => createHash('sha256').update(token).digest('hex')

async function revokeToken (token, exp) {
  if (exp - Math.floor(Date.now() / 1000) <= 0) return
  await repository.insertRevokedToken(hashToken(token), exp)
}

function isRevoked (token) {
  return repository.hasRevokedToken(hashToken(token))
}

module.exports = { verifyNotificationAuthorization, fetchOperatorByNumeroBio, getUserProfileById, getUserProfileFromSSOToken, getDepartement, revokeToken, isRevoked }
