'use strict'

const memo = require('p-memoize')
const { get, post } = require('got')
const { createDecoder, createVerifier } = require('fast-jwt')
const { populateWithRecords, normalizeOperator } = require('../outputs/operator.js')

/**
 * Types which depends on the Agence Bio API
 */

/**
 * @typedef {Object} OrganismeCertificateur
 * @property {Number} id
 * @property {String} nom
 * @property {String=} numeroControleEu
 */

/**
 * An operator as returned by Agence Bio API
 * @typedef {Object} AgenceBioOperator
 * @property {Number} id
 * @property {String} nom
 * @property {String} denominationCourante
 * @property {String} siret
 * @property {String} echeanceSiret
 * @property {String} flag
 * @property {String} numeroBio
 * @property {String} echangeSiret
 * @property {String} email
 * @property {String} gerant
 * @property {String} telephone
 * @property {String} telephoneCommerciale
 * @property {String} numeroPacage
 * @property {String} dateFinConversion
 * @property {Number} lat
 * @property {Number} long
 * @property {Boolean} mandate
 * @property {Date} dateMaj
 * @property {Date} dateEngagement
 * @property {String} codeNAF
 * @property {Number} reseauId
 * @property {Number} departementId
 * @property {Object[]} photo
 * @property {String[]} sitesWeb
 * @property {AgenceBioNotification[]=} notifications
 * @property {AgenceBioCertificate[]=} certificats
 */

/**
 * @typedef {Object} AgenceBioCertificate
 * @property {String} organisme
 * @property {String} date
 * @property {String} url
 */

/**
 * @typedef {Object} AgenceBioNotification
 * @property {Number} id
 * @property {Boolean} active
 * @property {String=} dateArret
 * @property {String=} dateChangementEffet
 * @property {String=} dateDemarrage
 * @property {String=} dateFinRetrait
 * @property {String=} dateFinSuspension
 * @property {String=} dateHabilitation
 * @property {String=} dateRetrait
 * @property {String=} dateSignatureContrat
 * @property {String=} dateSuspension
 * @property {Boolean} dispenseOc
 * @property {String=} dispenseOcMotif
 * @property {String} etatCertification
 * @property {String=} motifRefus
 * @property {String=} motifDelete
 * @property {Number} operateurId
 * @property {OrganismeCertificateur} organismeCertificateur
 * @property {String=} numeroNotification
 * @property {String=} numeroClient
 * @property {String} organisme
 * @property {String} date
 * @property {String} status
 * @property {String=} url
 * @property {AgenceBioActivity[]} activites
 * @property {AgenceBioUserProduction[]} productions
 */

/**
 * @typedef {Object} AgenceBioAdresses
 * @property {String} lieu
 * @property {String} dates
 * @property {String} codePostal
 * @property {String} ville
 */

/**
 * Only some endpoints provide this data
 * @typedef {AgenceBioOperator} AgenceBioOperatorWithAdresses
 * @property {AgenceBioAdresses[]} adressesOperateurs
 */

/**
 * @typedef {Object} AgenceBioActivity
 * @property {Number} id
 * @property {String} nom
 */

/**
 * @typedef {Object} AgenceBioProduction
 * @property {Number} id
 * @property {String} nom
 * @property {Number} parent
 */

/**
 * @typedef {Object} AgenceBioUserGroup
 * @property {String} id
 * @property {String} nom
 */

/**
 * User as returned by Agence Bio SSO or API
 * @typedef {Object} AgenceBioOCUser
 * @property {Number} id
 * @property {String} prenom
 * @property {String} nom
 * @property {OrganismeCertificateur} organismeCertificateur
 * @property {AgenceBioUserGroup[]} groups
 * @property {AgenceBioUserGroup} mainGroup
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
 * @returns {Promise<AgenceBioOCUser>}
 */
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
 * @returns {Promise<AgenceBioOCUser>}
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
    const payload = verify(token)
    return { payload, token }
  } catch (error) {
    return { error }
  }
}

/**
 * Returns operators matching a query
 * @param q
 * @returns {Promise<AgenceBioNormalizedOperator>}
 */
async function operatorLookup ({ q }) {
  const token = await auth()
  const activites = ACTIVITE_PRODUCTION
  const headers = {
    Origin,
    Authorization: `Bearer ${token}`
  }

  /** @type {Array.<AgenceBioOperator>} */
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
 * @returns {Promise<AgenceBioOperator>}
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
 * @returns {Promise<AgenceBioOperator>}
 */
const getOperatorsByOc = memo(_getOperatorsByOc, {
  maxAge: 12 * ONE_HOUR,
  cacheKey: JSON.stringify
})

/**
 * Returns operators for a given user
 * @param userId
 * @return {Promise<*>}
 */
async function fetchUserOperators (userId) {
  const { items } = await get(`${config.get('notifications.endpoint')}/api/utilisateur/${userId}/operateurs`, {
    headers: { Authorization: serviceToken, Origin }
  }).json()

  return items.map(normalizeOperator)
}

/**
 * @param  {{numeroBio: number?, ocId: number, nom: string?}}
 * @returns {Array.<AgenceBioNormalizedOperator>}
 */
async function fetchCustomersByOc ({ ocId: oc, numeroBio = '', nom = '' }) {
  const operators = await getOperatorsByOc({ serviceToken, oc, numeroBio, nom })
  return populateWithRecords(operators.map(normalizeOperator))
}

/**
 * Fetch an operator by its id
 * @param operatorId
 * @returns {Promise<AgenceBioNormalizedOperator>}
 */
async function fetchOperatorById (operatorId) {
  const token = await auth()

  const data = await get(`${config.get('notifications.endpoint')}/portail/operateur/v2/${operatorId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin
    }
  }).json()

  return normalizeOperator(data)
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
 * @readonly
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
 * @returns {EtatProduction|String}
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
  fetchCertificationBody,
  fetchOperatorById,
  fetchOperatorByNumeroBio,
  fetchUserOperators,
  fetchCustomersByOc,
  getUserProfileById,
  getUserProfileFromSSOToken,
  operatorLookup,
  normalizeEtatProduction,
  parsePacDetailsFromComment,
  verifyNotificationAuthorization
}
