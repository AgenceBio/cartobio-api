'use strict'

const memo = require('p-memoize')
// @ts-ignore
const { get, post } = require('got')
const { createDecoder, createVerifier } = require('fast-jwt')
const { populateWithRecords, normalizeOperator } = require('../outputs/operator.js')

/**
 * @typedef {import('./types/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('./types/cartobio').CartoBioOCUser} CartoBioOCUser
 * @typedef {import('../outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 * @typedef {import('./types/agence-bio').AgenceBioUserGroup} AgenceBioUserGroup
 * @typedef {import('./types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 */

/**
 * Types which depends on the Agence Bio API
 */

const config = require('../config.js')
const Origin = config.get('notifications.origin')
/**
 * @type {String}
 */
const serviceToken = config.get('notifications.serviceToken')

const decode = createDecoder()
const verify = createVerifier({ key: config.get('notifications.publicKey') })

const ONE_HOUR = 60 * 60 * 1000

/**
 * Authenticate a user based on environment variables
 * It is a good idea to memoize it for a few hours to save on API calls
 *
 * @returns {String}            A JWT Auth Token
 */
const auth = memo(() => fetchAuthToken({
  email: config.get('notifications.cartobio.user'),
  motDePasse: config.get('notifications.cartobio.password')
}), { maxAge: 6 * ONE_HOUR })

/**
 * @param {{ email: String, motDePasse: String }} credentials
 * @returns {Promise<String>} A JWT Auth Token
 */
function fetchAuthToken ({ email, motDePasse }) {
  return post(`${config.get('notifications.endpoint')}/api/auth/login`, {
    json: { email, motDePasse },
    headers: { Origin }
  })
    .json()
    .then(({ token }) => token)
}

/**
 * Retrieves all certification body to date
 *
 * @param {String} token
 * @returns {Promise.<OrganismeCertificateur[]>}
 */
function _fetchCertificationBody (token) {
  return get(`${config.get('notifications.endpoint')}/portail/organismesCertificateurs`, {
    headers: { Authorization: `Bearer ${token}`, Origin }
  }).json()
}

/**
 * Retrieves all certification body to date
 * @param {String} token
 * @returns {Promise.<OrganismeCertificateur[]>}
 */
const fetchCertificationBody = memo(
  _fetchCertificationBody,
  { maxAge: 24 * ONE_HOUR }
)

/**
 *
 * @param userId
 * @param token
 * @returns {Promise<CartoBioUser>}
 */
async function getUserProfileById (userId, token = null) {
  const responses = await Promise.all([
    get(`${config.get('notifications.endpoint')}/api/users/${userId}`, {
      headers: { Authorization: `Bearer ${token || await auth()}`, Origin }
    }).json(),
    fetchCertificationBody(token || await auth())
  ])
  /**
   * @type {Object}
   * @property {Number} id
   * @property {String} prenom
   * @property {String} nom
   * @property {AgenceBioUserGroup[]} groupes
   * @property {Number=} organismeCertificateurId
   */
  const userProfile = responses[0]
  /**
   * @type {OrganismeCertificateur[]}
   */
  const OCs = responses[1]

  return {
    id: userProfile.id,
    prenom: userProfile.prenom,
    nom: userProfile.nom,
    ...(userProfile.organismeCertificateurId
      ? {
          organismeCertificateur: {
            id: userProfile.organismeCertificateurId,
            nom: OCs.find(({ id }) => userProfile.organismeCertificateurId === id)?.nom ?? ''
          }
        }
      : {}),
    groups: userProfile.groupes.map(({ id, nom }) => ({ id, nom })),
    // TODO: remove this once front and api are aligned
    mainGroup: {
      id: userProfile.groupes.at(0)?.id,
      nom: userProfile.groupes.at(0)?.nom
    }
  }
}

/**
 * @param accessToken
 * @returns {Promise<CartoBioUser|CartoBioOCUser>}
 */
async function getUserProfileFromSSOToken (accessToken) {
  const decodedToken = decode(accessToken)

  const { sub: email } = decodedToken
  const userProfile = await get(`${config.get('notifications.endpoint')}/api/utilisateur/by-email`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin },
    searchParams: { email }
  }).json()

  // 2. Fetch a more complete userProfile
  // Used as a token, it helps bootstrap the front application without an extra server roundtrip
  return getUserProfileById(userProfile.id, accessToken)
}

function verifyNotificationAuthorization (authorizationHeader) {
  const token = authorizationHeader.replace(/Bearer /i, '')

  try {
    const decodedToken = verify(token)
    return { decodedToken, token }
  } catch (error) {
    return { error }
  }
}

/**
 * Returns operators related to an OC, and eventual filters (numeroBio, or pacage)
 *
 * @param {{serviceToken: string, oc: number, numeroBio: string?, pacage: string?, nom: string?}} params
 * @returns {Promise<AgenceBioNormalizedOperator[]>}
 */
async function _getOperatorsByOc ({ serviceToken, oc, numeroBio = '', pacage = '', nom = '' }) {
  const data = await get(`${config.get('notifications.endpoint')}/api/oc/${oc}/operateurs`, {
    headers: {
      Authorization: serviceToken,
      Origin
    },
    searchParams: {
      nom,
      numeroBio,
      pacage,
      includeAdresses: 1
    }
  }).json()

  return data.map(normalizeOperator)
}

/**
 * Returns operators related to an OC, and eventual filters (numeroBio, or pacage)
 *
 * @param {{serviceToken: String, oc: number, numeroBio: String?, pacage: String?, nom: String?}} params
 * @returns {Promise<AgenceBioNormalizedOperator[]>}
 */
const getOperatorsByOc = memo(_getOperatorsByOc, {
  maxAge: 12 * ONE_HOUR,
  cacheKey: JSON.stringify
})

/**
 * Returns operators for a given user
 * @param userId
 * @return {Promise<AgenceBioNormalizedOperator[]>}
 */
async function fetchUserOperators (userId) {
  const { items } = await get(`${config.get('notifications.endpoint')}/api/utilisateur/${userId}/operateurs`, {
    headers: { Authorization: serviceToken, Origin }
  }).json()

  return items.map(normalizeOperator)
}

/**
 * @param  {{numeroBio: String?, ocId: number, nom: string?}} params
 * @returns {Promise<AgenceBioNormalizedOperatorWithRecord[]>}
 */
async function fetchCustomersByOc ({ ocId: oc, numeroBio = '', nom = '' }) {
  const operators = await getOperatorsByOc({ serviceToken, oc, numeroBio, nom })
  return populateWithRecords(operators)
}

/**
 * @param numeroBio
 * @returns {Promise<AgenceBioNormalizedOperator>}
 */
async function fetchOperatorByNumeroBio (numeroBio) {
  const token = await auth()

  const data = await get(`${config.get('notifications.endpoint')}/api/operateurs/${numeroBio}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin
    }
  }).json()

  return normalizeOperator(data)
}

/**
 * @param {String} token
 * @returns {Promise<OrganismeCertificateur>}
 */
async function checkOcToken (token) {
  return post(`${config.get('notifications.endpoint')}/api/oc/check-token`, {
    headers: {
      Authorization: serviceToken,
      Origin
    },
    json: { token }
  }).json()
}

/**
 * @param {String} commentaire
 * @returns {{ numeroIlot: String, numeroParcelle: String }}
 */
function parsePacDetailsFromComment (commentaire) {
  let result = { numeroIlot: '', numeroParcelle: '' }

  const RE = /ilot\s+(?<numeroIlot>\d+)\s+parcelle\s+(?<numeroParcelle>\d+)/i
  const RE_INVERTED = /parcelle\s+(?<numeroParcelle>\d+)\s+ilot\s+(?<numeroIlot>\d+)/i
  const RE_COMPACT = /ilot-(?<numeroIlot>\d+)-(?<numeroParcelle>\d+)/i;

  [RE, RE_INVERTED, RE_COMPACT].some(REG => {
    if (REG.test(commentaire)) {
      // @ts-ignore
      result = { ...commentaire.match(REG).groups }
      return true
    }

    return false
  })

  return result
}

module.exports = {
  auth,
  checkOcToken,
  fetchCertificationBody,
  fetchOperatorByNumeroBio,
  fetchUserOperators,
  fetchCustomersByOc,
  getUserProfileById,
  getUserProfileFromSSOToken,
  parsePacDetailsFromComment,
  verifyNotificationAuthorization
}
