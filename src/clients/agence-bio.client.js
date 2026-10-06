'use strict'

const memo = require('p-memoize')
// @ts-ignore
const { get, post } = require('got')
const { normalizeOperator, getFilterData, applyOperatorTextSearch } = require('../shared/outputs/operator.js')

/**
 * @typedef {import('./types/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('./types/cartobio').CartoBioOCUser} CartoBioOCUser
 * @typedef {import('./types/cartobio').OperatorFilter} OperatorFilter
 * @typedef {import('../shared/outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('../shared/outputs/types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('../shared/outputs/types/operator').AgenceBioNormalizedOperatorWithFilterData} AgenceBioNormalizedOperatorWithFilterData
 * @typedef {import('./types/agence-bio').AgenceBioUserGroup} AgenceBioUserGroup
 * @typedef {import('./types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 */

/**
 * Types which depends on the Agence Bio API
 */

const config = require('../config/env.js')
const Origin = config.get('notifications.origin')
/**
 * @type {String}
 */
const serviceToken = config.get('notifications.serviceToken')

const ONE_MINUTE = 60 * 1000

/**
 * Retrieves all certification body to date
 *
 * @returns {Promise.<OrganismeCertificateur[]>}
 */
/**
 * Returns operators related to an OC
 *
 * @param {{serviceToken: string, oc: number }} params
 * @returns {Promise<AgenceBioNormalizedOperator[]>}
 */
async function _getOperatorsByOc ({ serviceToken, oc }) {
  const limit = 10000
  const data = await get(`${config.get('notifications.endpoint')}/api/oc/${oc}/operateurs`, {
    headers: {
      Authorization: serviceToken,
      Origin
    },
    searchParams: {
      limit,
      orderBy: 'nom'
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
        page: page + 1,
        orderBy: 'nom'
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
  * Returs operators for admin profile
  *
*/
async function _getOperatorsForAdmin ({ serviceToken, input = '' }) {
  const limit = 10000

  const fetchPage = (searchParams) =>
    get(`${config.get('notifications.endpoint')}/api/operateurs/cartobio`, {
      headers: {
        Authorization: serviceToken,
        Origin
      },
      searchParams: { limit, ...searchParams }
    }).json()

  const fetchAllPages = async (baseParams) => {
    const data = await fetchPage(baseParams)
    if (data.nbTotal === data.operateurs.length) {
      return data.operateurs
    }

    const requests = []
    for (let page = 1; page * limit < data.nbTotal; page++) {
      requests.push(fetchPage({ ...baseParams, page: page + 1 }))
    }

    const results = await Promise.all(requests)
    return results.reduce((all, res) => all.concat(res.operateurs), data.operateurs)
  }

  const isInteger = Number.isInteger(Number(input))

  const results = await Promise.all([
    fetchAllPages({ nom: input }),
    ...(isInteger
      ? [
          fetchAllPages({ numeroBio: input }),
          fetchAllPages({ siret: input })
        ]
      : [])
  ])

  const seen = new Set()
  return results
    .flat()
    .filter((op) => {
      if (seen.has(op.numeroBio)) return false
      seen.add(op.numeroBio)
      return true
    })
    .map(normalizeOperator)
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
 * Returns operators related to admin, and eventual filters (numeroBio, or pacage)
 *
 * @param {{serviceToken: String, oc: number, numeroBio: String?, pacage: String?, nom: String?, siret: String?, input: String? }} params
 * @returns {Promise<AgenceBioNormalizedOperator[]>}
 */
const getOperatorsForAdmin = memo(_getOperatorsForAdmin, {
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

async function fetchCustomersByAdmin ({ input = '' }) {
  const operateurs = (await getOperatorsForAdmin({ serviceToken, input })).filter((operator) => operator.notifications != null)
  return getFilterData(operateurs, false)
}

/**
 * @param  { string } input
 * @param  { number } oc
 * @param  {OperatorFilter} filter
 * @param  { number[] } pinnedOperators
 * @returns {Promise<AgenceBioNormalizedOperatorWithFilterData[]>}
 */
async function fetchCustomersByOcWithRecords (input, oc, filter = {}, pinnedOperators = []) {
  let operators = await getOperatorsByOc({ serviceToken, oc })

  operators = operators.filter((operator) => operator.notifications != null && operator.notifications.status !== 'BROUILLON')

  if (input) {
    operators = operators.filter((operator) => applyOperatorTextSearch(operator, input))
  } else {
    operators = operators.filter((operator) => operator.isProduction === true)
  }

  // on filtre sur le status avant de recuperer les parcellaires
  if (filter?.etatNotification && filter.etatNotification.length > 0) {
    operators = operators.filter((item) =>
      (item.notifications.organismeCertificateurId === oc && filter.etatNotification.includes(item.notifications.etatCertification)) ||
      (item.notifications.organismeCertificateurId !== oc && filter.etatNotification.includes('ARRETEE')))
  }
  // on filtre sur les opérateurs qui n'étaient pas engagés sur l'année concernée
  if (filter?.anneeReferenceCertification) {
    operators = operators.filter((item) => item.notifications.dateDemarrage && new Date(item.notifications.dateDemarrage).getFullYear() <= filter.anneeReferenceCertification)
  }

  if (filter?.departement && filter?.departement.length > 0) {
    operators = operators.filter((item) => {
      if (!item.departement) return false

      if (item.departement === '97') {
        const domCode = item.codeCommune?.substring(0, 3)
        return domCode && filter.departement.includes(domCode)
      }
      return filter.departement.includes(item.departement)
    })
  }

  if (filter?.pinned === true && Array.isArray(pinnedOperators)) {
    operators = operators.filter((item) => pinnedOperators.includes(+item.numeroBio))
  }

  if (filter.engagement && filter.engagement.length > 0) {
    return getFilterData(operators, true)
  }

  return getFilterData(operators, false)
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
 * @param {String} numeroBio
 * @returns {Promise<any>}
 */
async function fetchEmailForNumeroBio (numeroBio) {
  const data = await get(`${config.get('notifications.endpoint')}/api/operateur/${numeroBio}/utilisateurs-emails`, {
    headers: {
      Authorization: config.get('notifications.serviceToken'),
      Origin
    }
  }).json()
  return data
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
  fetchOperatorByNumeroBio,
  fetchUserOperators,
  fetchCustomersByOc,
  fetchCustomersByAdmin,
  fetchCustomersByOcWithRecords,
  parsePacDetailsFromComment,
  fetchEmailForNumeroBio
}
