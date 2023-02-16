'use strict'

const memo = require('p-memoize')
const { get, post } = require('got')
const { createDecoder } = require('fast-jwt')
const { format: formatPacage, unPrefix } = require('../pacage.js')
const { populateWithMetadata } = require('../outputs/operator.js')
const decode = createDecoder()

/**
 * @typedef { import('./agence-bio').Operateur } NotificationApiOperateur
 */

const departements = require('../../data/departements.json')
const departementsCentroids = require('../../data/departements-cendroids.json')

const config = require('../config.js')
const Origin = config.get('notifications.origin')

const ONE_HOUR = 60 * 60 * 1000
// const ONE_MINUTE = 60 * 1000
const ACTIVITE_PRODUCTION = 1

/**
 * Pick only the relevant fields
 *
 * @param  {Integer} numeroBio    [description]
 * @param  {String} numeroPacage [description]
 * @returns {Object<Operator>}
 */
function mapCustomersToIdentifiers (operator) {
  return {
    ...operator,
    numeroPacage: formatPacage(operator.numeroPacage)
  }
}

/**
 * Authenticate a user based on environemnt variables
 * It is a good idea to memoize it for a few hours to save on API calls
 *
 * @returns {String}            A JWT Auth Token
 */
const auth = memo(() => fetchAuthToken({
  email: config.get('notifications.cartobio.user'),
  motDePasse: config.get('notifications.cartobio.password')
}), { maxAge: 6 * ONE_HOUR })

/**
 * [fetchAuthToken description]
 * @param  {String} email      [description]
 * @param  {String} motDePasse [description]
 * @returns {String}            A JWT Auth Token
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
 *
 * @param {NotificationApiOperateur} operator
 * @returns {Object}
 */
function simplifyOperator (operator) {
  const { id, nom, denominationCourante, siret, numeroBio, numeroPacage, certificats, notifications, email, dateEngagement, datePremierEngagement, adressesOperateurs } = operator

  const { organismeCertificateur } = notifications ? notifications[0] : {}

  return {
    id,
    nom,
    denominationCourante,
    siret,
    numeroBio,
    numeroPacage,
    email,
    dateEngagement,
    certificats,
    datePremierEngagement,
    organismeCertificateur,
    codeCommune: adressesOperateurs[0]?.codeCommune ?? null,
    departement: adressesOperateurs[0]?.codeCommune?.slice(0, -3) ?? null,
    commune: adressesOperateurs[0]?.ville ?? null
  }
}

/**
 * Retrieves all certification body to date
 *
 * @param {String} token
 * @returns {Promise.<{id: number}[]>}
 */
function _fetchCertificationBody (token) {
  return get(`${config.get('notifications.endpoint')}/portail/organismesCertificateurs`, {
    headers: { Authorization: `Bearer ${token}`, Origin }
  }).json()
}

const fetchCertificationBody = memo(
  _fetchCertificationBody,
  { maxAge: 24 * ONE_HOUR }
)

/**
 * [fetchAuthToken description]
 * @param  {String} email      [description]
 * @param  {String} motDePasse [description]
 * @returns {String}            A JWT Auth Token
 */
function fetchUserProfile (token) {
  const { id: userId } = decode(token)

  return get(`${config.get('notifications.endpoint')}/portail/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}`, Origin }
  })
    .json()
    .then(userProfile => {
      userProfile.mainGroup = userProfile.groupes[0]

      delete userProfile.createdAt
      delete userProfile.updatedAt
      delete userProfile.envoyerPrincipauxEvenements
      delete userProfile.envoyerInfosPros
      delete userProfile.nbEmailEnvoye
      delete userProfile.telephone
      delete userProfile.profile
      delete userProfile.groupes

      return { userProfile, token }
    })
}

async function getUserProfileFromSSOToken (accessToken) {
  const decodedToken = decode(accessToken)

  // 1. Fetch a userId from the only reliable accessToken value
  const { sub: email } = decodedToken
  const { id } = await get(`${config.get('notifications.endpoint')}/api/utilisateur/by-email`, {
    headers: { Authorization: `Bearer ${accessToken}`, Origin },
    searchParams: { email }
  }).json()

  // 2. Fetch a more complete userProfile
  // Used as a token, it helps bootstrap the front application without an extra server roundtrip
  const userProfile = await get(`${config.get('notifications.endpoint')}/api/users/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Origin }
  }).json()

  return {
    id: userProfile.id,
    prenom: userProfile.prenom,
    nom: userProfile.nom,
    organismeCertificateurId: userProfile.organismeCertificateurId,
    organismeCertificateur: userProfile.organismeCertificateur ?? {},
    mainGroup: {
      id: userProfile.groupes.at(0)?.id,
      nom: userProfile.groupes.at(0)?.nom
    }
  }
}

async function operatorLookup ({ q }) {
  const token = await auth()
  const activites = ACTIVITE_PRODUCTION
  const headers = {
    Origin,
    Authorization: `Bearer ${token}`
  }

  /** @type {Array.<NotificationApiOperateur>} */
  const { items } = await get(`${config.get('notifications.endpoint')}/api/operateurs`, {
    headers,
    searchParams: { q, activites }
  }).json()

  return items.map(simplifyOperator)
}

/**
 * Returns operators related to an OC, and eventual filters (numeroBio, or pacage)
 *
 * @param {{token: string, oc: number, numeroBio: number?, pacage: string?, nom: string?}} params
 * @returns {Promise}
 */
function _getOperatorsByOc ({ token, oc, numeroBio = '', pacage = '', nom = '' }) {
  return get(`${config.get('notifications.endpoint')}/api/getOperatorsByOc`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin
    },
    searchParams: {
      oc,
      nom,
      numeroBio,
      pacage,
      activites: ACTIVITE_PRODUCTION,
      ...(numeroBio ? {} : { statusNotification: 'ACTIVE' })
    }
  }).json()
}

/**
 * Returns operators related to an OC, and eventual filters (numeroBio, or pacage)
 *
 * @param {{token: string, oc: number, numeroBio: number?, pacage: string?}} params
 * @returns {Promise}
 */
const getOperatorsByOc = memo(_getOperatorsByOc, {
  maxAge: 12 * ONE_HOUR,
  cacheKey: JSON.stringify
})

/**
 * [fetchCustomersByOperator description]
 * @param  {{numeroBio: number?, ocId: number, nom: string?}} options [description]
 * @returns {Array.<Operator>}      [description]
 */
async function fetchCustomersByOperator ({ ocId: oc, numeroBio = '', nom = '' }) {
  const token = await auth()

  return getOperatorsByOc({ token, oc, numeroBio, nom })
    .then((operators) => operators.map(mapCustomersToIdentifiers))
    .then(populateWithMetadata)
}

async function fetchOperatorById (operatorId) {
  const token = await auth()

  return get(`${config.get('notifications.endpoint')}/portail/operateur/v2/${operatorId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin
    }
  }).json()
    .then(data => simplifyOperator(data))
    .then(data => mapCustomersToIdentifiers(data))
}

/**
 * We get through all OC to see if one of them knows about this PACAGE
 *
 * @param {Pacage} pacage
 * @returns {Promise<{numeroBio: number, ocId: string}>}
 */
async function getCertificationBodyForPacage ({ numeroPacage }) {
  const token = await auth()
  const OCs = await fetchCertificationBody(token)

  // unfortunately, agenceBio asks for non-zero prefixed PACAGE.
  // maybe it will bite us in the future…
  const pacage = unPrefix(numeroPacage)

  const promises = OCs
    .map(oc => oc.id)
    .map(ocId => {
      return getOperatorsByOc({ token, oc: ocId, pacage })
        .then(result => result.length ? { ocId, numeroBio: result[0].numeroBio } : null)
    })

  const result = await Promise.all(promises)

  return result.find(response => response?.numeroBio)
}

/**
 * [getDepartementFromId description]
 * @param  {Integer} departementId [description]
 * @returns {{nom, code, centroid<Point>}}               [description]
 */
function getDepartementFromId (departementId) {
  const { codePostal } = departements.find(({ id }) => id === departementId)
  return departementsCentroids.find(({ code }) => code === codePostal)
}

module.exports = {
  fetchAuthToken,
  fetchOperatorById,
  fetchUserProfile,
  fetchCustomersByOperator,
  getCertificationBodyForPacage,
  getDepartementFromId,
  getUserProfileFromSSOToken,
  operatorLookup
}
