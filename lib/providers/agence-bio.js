'use strict'

const memo = require('p-memoize')
// @ts-ignore
const { get, post } = require('got')
const { createDecoder, createVerifier } = require('fast-jwt')
const { normalizeOperator, getFilterData, applyOperatorTextSearch } = require('../outputs/operator.js')

/**
 * @typedef {import('./types/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('./types/cartobio').CartoBioOCUser} CartoBioOCUser
 * @typedef {import('./types/cartobio').OperatorFilter} OperatorFilter
 * @typedef {import('../outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperatorWithFilterData} AgenceBioNormalizedOperatorWithFilterData
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

const ONE_MINUTE = 60 * 1000
const ONE_HOUR = 60 * ONE_MINUTE

/**
 * Retrieves all certification body to date
 *
 * @returns {Promise.<OrganismeCertificateur[]>}
 */
function _fetchCertificationBody () {
  return get(`${config.get('notifications.endpoint')}/api/oc`, {
    headers: { Authorization: config.get('notifications.serviceToken'), Origin }
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
async function getUserProfileById (userId) {
  const responses = await Promise.all([
    get(`${config.get('notifications.endpoint')}/api/users/${userId}`, {
      headers: { Authorization: config.get('notifications.serviceToken'), Origin }
    }).json(),
    fetchCertificationBody()
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
  return getUserProfileById(userProfile.id)
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
 * Returns operators related to an OC
 *
 * @param {{serviceToken: string, oc: number }} params
 * @returns {Promise<AgenceBioNormalizedOperator[]>}
 */
async function _getOperatorsByOc ({ serviceToken, oc }) {
  const limit = 5000
  const data = await get(`${config.get('notifications.endpoint')}/api/oc/${oc}/operateurs`, {
    headers: {
      Authorization: serviceToken,
      Origin
    },
    searchParams: {
      limit
    }
  }).json()

  if (data.nbTotal === data.operateurs.length) {
    return data.operateurs.map(normalizeOperator)
  }

  const requests = []
  for (let page = 1; page * limit < data.nbTotal; page++) {
    requests.push(get(`${config.get('notifications.endpoint')}/api/oc/${oc}/operateurs`, {
      headers: {
        Authorization: serviceToken,
        Origin
      },
      searchParams: {
        limit,
        page: page + 1
      }
    }).json())
  }

  return await Promise.all(requests).then((results) => {
    let allData = data.operateurs
    results.forEach((res) => {
      allData = allData.concat(res.operateurs)
    })

    return allData.map(normalizeOperator)
  })
}

/**
 * Returns operators related to an OC, and eventual filters (numeroBio, or pacage)
 *
 * @param {{serviceToken: String, oc: number, numeroBio: String?, pacage: String?, nom: String?, siret: String? }} params
 * @returns {Promise<AgenceBioNormalizedOperator[]>}
 */
const getOperatorsByOc = memo(_getOperatorsByOc, {
  maxAge: 10 * ONE_MINUTE,
  cacheKey: JSON.stringify
})

/**
 * Returns operators for a given user
 * @param userId
 * @return {Promise<{operators: AgenceBioNormalizedOperator[]}>}
 */
async function fetchUserOperators (userId) {
  const data = await get(`${config.get('notifications.endpoint')}/api/utilisateur/${userId}/operateurs`, {
    headers: {
      Authorization: serviceToken,
      Origin
    }
  }).json()

  return {
    operators: data.map(normalizeOperator)
  }
}

/**
 * @param  {number} oc
 * @returns {Promise<AgenceBioNormalizedOperator[]>}
 */
async function fetchCustomersByOc (oc) {
  return (await getOperatorsByOc({ serviceToken, oc })).filter((operator) => operator.notifications != null)
}

/**
 * @param  {{numeroBio: String?, ocId: number, nom: string?, siret: string?}} params
 * @param  {OperatorFilter} filter
 * @param  { number[] } pinnedOperators
 * @returns {Promise<AgenceBioNormalizedOperatorWithFilterData[]>}
 */
async function fetchCustomersByOcWithRecords ({ ocId: oc, siret = '', numeroBio = '', nom = '' }, filter = {}, pinnedOperators = []) {
  let operators = await getOperatorsByOc({ serviceToken, oc })

  operators = operators.filter((operator) => operator.notifications !== null)

  if (siret || numeroBio || nom) {
    operators = operators.filter((operator) => applyOperatorTextSearch(operator, siret, numeroBio, nom))
  } else {
    operators = operators.filter((operator) => operator.isProduction === true)
  }

  // On enelve les brouillons
  operators = operators.filter(item => item.notifications && item.notifications.status !== 'BROUILLON')

  // on filtre sur le status avant de recuperer les parcellaires
  if (filter?.etatNotification && filter?.etatNotification.length > 0) {
    operators = operators.filter((item) => item.notifications && filter?.etatNotification.includes(item.notifications.etatCertification))
  }
  // on filtre sur les opérateurs qui n'étaient pas engagés sur l'année concernée
  if (filter?.anneeReferenceCertification) {
    operators = operators.filter((item) => item.notifications && item.notifications.dateDemarrage && new Date(item.notifications.dateDemarrage).getFullYear() <= filter?.anneeReferenceCertification)
  }

  if (filter?.departement && filter?.departement.length > 0) {
    operators = operators.filter((item) => item.departement && filter?.departement.includes(item.departement))
  }

  if (filter?.pinned === true && Array.isArray(pinnedOperators)) {
    operators = operators.filter((item) => pinnedOperators.includes(+item.numeroBio))
  }

  if ((filter.etatCertification != null && filter.etatCertification !== 'ALL') || (filter.statutParcellaire &&
    filter.statutParcellaire.length > 0)) {
    if (filter.engagement && filter.engagement.length > 0) {
      return getFilterData(operators, true, true)
    }
    return getFilterData(operators, true, false)
  }

  if (filter.engagement && filter.engagement.length > 0) {
    return getFilterData(operators, false, true)
  }

  return operators
}

/**
 * @param {String} numeroBio
 * @returns {Promise<AgenceBioNormalizedOperator>}
 */
async function fetchOperatorByNumeroBio (numeroBio) {
  const data = await get(`${config.get('notifications.endpoint')}/api/operateur/${numeroBio}`, {
    headers: {
      Authorization: config.get('notifications.serviceToken'),
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
  let result = { numeroIlot: null, numeroParcelle: null }

  // @ts-ignore
  const RE = /ilot\s+(?<numeroIlot>\d+)\s+parcelle\s+(?<numeroParcelle>\d+)/i
  // @ts-ignore
  const RE_INVERTED = /parcelle\s+(?<numeroParcelle>\d+)\s+ilot\s+(?<numeroIlot>\d+)/i
  // @ts-ignore
  const RE_COMPACT = /ilot-(?<numeroIlot>\d+)-(?<numeroParcelle>\d+)/i;

  [RE, RE_INVERTED, RE_COMPACT].forEach(REG => {
    if (REG.test(commentaire)) {
      // @ts-ignore
      result = { ...commentaire.match(REG).groups }
    }
  })

  return result
}

module.exports = {
  checkOcToken,
  fetchCertificationBody,
  fetchOperatorByNumeroBio,
  fetchUserOperators,
  fetchCustomersByOc,
  fetchCustomersByOcWithRecords,
  getUserProfileById,
  getUserProfileFromSSOToken,
  parsePacDetailsFromComment,
  verifyNotificationAuthorization
}
