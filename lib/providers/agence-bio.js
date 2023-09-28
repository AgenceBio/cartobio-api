'use strict'

const memo = require('p-memoize')
const { get, post } = require('got')
const { createDecoder, createVerifier } = require('fast-jwt')
const { format: formatPacage } = require('../pacage.js')
const { populateWithMetadata } = require('../outputs/operator.js')

/**
 * @typedef { import('./agence-bio').Operateur } NotificationApiOperateur
 */

const config = require('../config.js')
const Origin = config.get('notifications.origin')
const serviceToken = config.get('notifications.serviceToken')

const decode = createDecoder()
const verify = createVerifier({ key: config.get('notifications.publicKey') })

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
 * @param {import('./agence-bio').Operateur} operator
 * @return {import('./agence-bio').OrganismeCertificateur}
 */
function deriveOrganismeCertificateurFromOperator (operator) {
  // we have a valid certificate, let's use it
  if (Array.isArray(operator.certificats) && operator.certificats.at(0)?.organismeCertificateurId) {
    const { organismeCertificateurId: id, organisme: nom } = operator.certificats.at(0)
    return { id, nom }
  // we have only a notification (notified, but not yet certified)
  }

  if (Array.isArray(operator.notifications) && operator.notifications.length) {
    const { organismeCertificateur } = operator.notifications.at(0)

    if (organismeCertificateur) {
      return {
        id: organismeCertificateur.id,
        nom: organismeCertificateur.nom
      }
    }
  }

  return {}
}

/**
 *
 * @param {NotificationApiOperateur} operator
 * @returns {Object}
 */
function normalizeOperator (operator) {
  const { id, nom, denominationCourante, siret, numeroBio, numeroPacage, certificats, notifications, email, dateEngagement, datePremierEngagement, adressesOperateurs = [] } = operator
  const organismeCertificateur = deriveOrganismeCertificateurFromOperator(operator)

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
    commune: adressesOperateurs[0]?.ville ?? null,
    codePostal: adressesOperateurs[0]?.codePostal ?? null,
    notifications
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

async function getUserProfileById (userId, token = null) {
  const [userProfile, OCs] = await Promise.all([
    get(`${config.get('notifications.endpoint')}/api/users/${userId}`, {
      headers: { Authorization: `Bearer ${token || await auth()}`, Origin }
    }).json(),
    fetchCertificationBody(token || await auth())
  ])

  return {
    id: userProfile.id,
    prenom: userProfile.prenom,
    nom: userProfile.nom,
    organismeCertificateur: {
      id: userProfile.organismeCertificateurId,
      nom: OCs.find(({ id }) => userProfile.organismeCertificateurId === id)?.nom ?? ''
    },
    groups: userProfile.groupes.map(({ id, nom }) => ({ id, nom })),
    // TODO: remove this once front and api are aligned
    mainGroup: {
      id: userProfile.groupes.at(0)?.id,
      nom: userProfile.groupes.at(0)?.nom
    }
  }
}

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
    const payload = verify(token)
    return { payload, token }
  } catch (error) {
    return { error }
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
    searchParams: { q, activites, nb: 30 }
  }).json()

  return items.map(normalizeOperator)
}

/**
 * Returns operators related to an OC, and eventual filters (numeroBio, or pacage)
 *
 * @param {{serviceToken: string, oc: number, numeroBio: number?, pacage: string?, nom: string?}} params
 * @returns {Promise}
 */
function _getOperatorsByOc ({ serviceToken, oc, numeroBio = '', pacage = '', nom = '' }) {
  return get(`${config.get('notifications.endpoint')}/api/getOperatorsByOc`, {
    headers: {
      Authorization: serviceToken,
      Origin
    },
    searchParams: {
      oc,
      nom,
      numeroBio,
      pacage,
      includeAdresses: 1
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
  let operators = await getOperatorsByOc({ serviceToken, oc, numeroBio, nom })
  operators = await populateWithMetadata(operators.map(mapCustomersToIdentifiers))
  return operators.map(normalizeOperator)
}

async function fetchOperatorById (operatorId) {
  const token = await auth()

  return get(`${config.get('notifications.endpoint')}/portail/operateur/v2/${operatorId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin
    }
  }).json()
    .then(data => normalizeOperator(data))
    .then(data => mapCustomersToIdentifiers(data))
}

async function fetchOperatorByNumeroBio (numeroBio) {
  const token = await auth()

  return get(`${config.get('notifications.endpoint')}/api/operateurs/${numeroBio}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin
    }
  }).json()
    .then(data => normalizeOperator(data))
    .then(data => mapCustomersToIdentifiers(data))
}

function checkOcToken (token) {
  return post(`${config.get('notifications.endpoint')}/api/oc/check-token`, {
    headers: {
      Authorization: serviceToken,
      Origin
    },
    json: { token }
  }).json()
}

/**
 * @typedef {Object} OrganismeCertificateur
 * @property {String} id
 * @property {String} nom
 */

/**
 * @typedef {Object} ParcellaireApiRecord
 * @property {Number|String} numeroBio
 * @property {Number|String} numeroClient
 * @property {Number} anneeReferenceControle
 * @property {Number} anneeAssolement
 * @property {String} dateAudit
 * @property {Number|String} numeroPacage
 * @property {ParcellaireApiParcelle[]} parcelles
 */

/**
 * @enum {String}
 */
const EtatProduction = {
  C0: 'CONV',
  CONV: 'CONV',
  NB: 'CONV',
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
  AB: 'AB'
}

/**
 * @typedef {Object} ParcellaireApiParcelle
 * @property {Number|String} id
 * @property {String} dateEngagement
 * @property {EtatProduction} etatProduction
 * @property {String=} numeroIlot
 * @property {String=} numeroParcelle
 * @property {String=} commentaire
 * @property {String} geom
 * @property {ParcellaireApiCulture[]} culture
 */

/**
 * @typedef {Object} ParcellaireApiCulture
 * @property {String} codeCPF
 * @property {String} precision
 * @property {Number|String} quantite
 * @property {String=} unite
 */

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
      result = { ...commentaire.match(REG).groups }
      return true
    }

    return false
  })

  return result
}

/**
 * @param {String} etat
 * @returns {EtatProduction}
 */
function normalizeEtatProduction (etat) {
  if (Object.hasOwn(EtatProduction, etat)) {
    return EtatProduction[etat]
  }

  return etat
}

module.exports = {
  auth,
  checkOcToken,
  EtatProduction,
  fetchAuthToken,
  fetchCertificationBody,
  fetchOperatorById,
  fetchOperatorByNumeroBio,
  fetchCustomersByOperator,
  getUserProfileById,
  getUserProfileFromSSOToken,
  operatorLookup,
  normalizeEtatProduction,
  parsePacDetailsFromComment,
  verifyNotificationAuthorization
}
