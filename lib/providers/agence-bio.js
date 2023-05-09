'use strict'

const memo = require('p-memoize')
const { get, post } = require('got')
const { createDecoder, createVerifier } = require('fast-jwt')
const JSONStream = require('jsonstream-next')
const { format: formatPacage } = require('../pacage.js')
const { populateWithMetadata } = require('../outputs/operator.js')

/**
 * @typedef { import('./agence-bio').Operateur } NotificationApiOperateur
 */

const config = require('../config.js')
const { fromCodeCpf } = require('@agencebio/rosetta-cultures')
const Origin = config.get('notifications.origin')

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
  if (Array.isArray(operator.certificats) && operator.certificats.at(0).organismeCertificateurId) {
    const { organismeCertificateurId: id, organisme: nom } = operator.certificats.at(0)
    return { id, nom }
  // we have only a notification (notified, but not yet certified)
  } else if (Array.isArray(operator.notifications) && operator.notifications.length) {
    const { organismeCertificateur } = operator.notifications.at(0)

    return {
      id: organismeCertificateur.id,
      nom: organismeCertificateur.nom
    }
  // nothing?
  } else {
    return {}
  }
}

/**
 *
 * @param {NotificationApiOperateur} operator
 * @returns {Object}
 */
function normalizeOperator (operator) {
  const { id, nom, denominationCourante, siret, numeroBio, numeroPacage, certificats, notifications, email, dateEngagement, datePremierEngagement, adressesOperateurs } = operator
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

  return { payload: verify(token), token }
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

  return items.map(normalizeOperator)
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

/**
 * @param {ReadableStream} stream
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  for await (const record of stream.pipe(JSONStream.parse([true]))) {
    const features = record.produits
      // retain only organic productions
      .filter(({ activites }) => activites === String(ACTIVITE_PRODUCTION))
      // turn products into features
      .map(produit => ({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: JSON.parse(produit.geom)
        },
        properties: {
          CAMPAGNE: record.anneeReferenceControle,
          culture_cpf: produit.codeCPF,
          /* eslint-disable-next-line camelcase */
          TYPE: fromCodeCpf(produit.codeCPF).cultures_pac.find(({ requires_precision }) => requires_precision === false)?.code,
          NUMERO_I: produit.numeroIlot,
          NUMERO_P: produit.numeroParcelle,
          PACAGE: record.numeroPacage,
          conversion_niveau: produit.etatProduction
        }
      }))

    // emit a data structure similar to what `/v2/operator/${operatorId}/parcelles` consumes
    yield {
      ocId: organismeCertificateur.id,
      ocLabel: organismeCertificateur.nom,
      numeroBio: record.numeroBio,
      numeroPacage: record.numeroPacage,
      geojson: {
        type: 'FeatureCollection',
        features
      }
    }
  }
}

module.exports = {
  auth,
  fetchAuthToken,
  fetchCertificationBody,
  fetchOperatorById,
  fetchOperatorByNumeroBio,
  fetchCustomersByOperator,
  getUserProfileById,
  getUserProfileFromSSOToken,
  operatorLookup,
  parseAPIParcellaireStream,
  verifyNotificationAuthorization
}
