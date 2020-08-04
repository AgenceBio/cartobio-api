'use strict'

const memo = require('p-memoize')
const { get, post } = require('got')
const { decode } = require('jsonwebtoken')
const { format: formatPacage, unPrefix } = require('../pacage.js')
const { populateWithMetadata } = require('../outputs/operator.js')

const departements = require('../../data/departements.json')
const departementsCentroids = require('../../data/departements-cendroids.json')

const {
  NOTIFICATIONS_AB_ENDPOINT,
  NOTIFICATIONS_AB_CARTOBIO_USER,
  NOTIFICATIONS_AB_CARTOBIO_PASSWORD
} = require('../app.js').env()

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
  email: NOTIFICATIONS_AB_CARTOBIO_USER,
  motDePasse: NOTIFICATIONS_AB_CARTOBIO_PASSWORD
}), { maxAge: 6 * ONE_HOUR })

/**
 * [fetchAuthToken description]
 * @param  {String} email      [description]
 * @param  {String} motDePasse [description]
 * @returns {String}            A JWT Auth Token
 */
function fetchAuthToken ({ email, motDePasse }) {
  return post(`${NOTIFICATIONS_AB_ENDPOINT}/api/auth/login`, {
    json: { email, motDePasse }
  })
    .json()
    .then(({ token }) => token)
}

/**
 * Retrieves all certification body to date
 *
 * @param {String} token
 * @returns {Promise.<{id: number}[]>}
 */
function _fetchCertificationBody (token) {
  return get(`${NOTIFICATIONS_AB_ENDPOINT}/portail/organismesCertificateurs`, {
    headers: { Authorization: `Bearer ${token}` }
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

  return get(`${NOTIFICATIONS_AB_ENDPOINT}/portail/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}` }
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

/**
 * Returns operators related to an OC, and eventual filters (numeroBio, or pacage)
 *
 * @param {{token: string, oc: number, numeroBio: number?, pacage: string?}} params
 * @returns {Promise}
 */
function _getOperatorsByOc ({ token, oc, numeroBio = '', pacage = '' }) {
  return get(`${NOTIFICATIONS_AB_ENDPOINT}/api/getOperatorsByOc`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    searchParams: {
      oc,
      numeroBio,
      pacage,
      activites: ACTIVITE_PRODUCTION,
      statusNotification: 'ACTIVE'
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
 * @param  {[type]} ocId [description]
 * @returns {Array.<Operator>}      [description]
 */
async function fetchCustomersByOperator ({ ocId: oc, numeroBio = '' }) {
  const token = await auth()

  return getOperatorsByOc({ token, oc, numeroBio })
    .then((operators) => operators.map(mapCustomersToIdentifiers))
    .then(populateWithMetadata)
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
  const { codePostal } = departements.find(({ id, codePostal }) => id === departementId)
  return departementsCentroids.find(({ code }) => code === codePostal)
}

module.exports = {
  fetchAuthToken,
  fetchUserProfile,
  fetchCustomersByOperator,
  getCertificationBodyForPacage,
  getDepartementFromId
}
