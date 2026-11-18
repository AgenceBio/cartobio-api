import memo from 'p-memoize'
import gotModule from 'got'
const got = gotModule.default
const { get, post } = got
import { normalizeOperator } from '../shared/outputs/operator.js'

import config from '../config/env.js'
import type {
  AgenceBioNormalizedOperator,
  OrganismeCertificateur,
  AgenceBioOperator,
  AgenceBioOperatorEmails,
  AgenceBioNotification
} from '@agencebio/cartobio-types'
const Origin = config.get('notifications.origin')
const serviceToken: string = config.get('notifications.serviceToken')

const ONE_MINUTE = 60 * 1000

interface OperateursPage {
  nbTotal: number
  operateurs: AgenceBioOperator[]
}

export type OperatorWithNotification = AgenceBioNormalizedOperator & { notifications: AgenceBioNotification }

function hasNotification(operator: AgenceBioNormalizedOperator): operator is OperatorWithNotification {
  return operator.notifications != null
}

/**
 * Returns operators related to an OC
 */
async function _getOperatorsByOc({
  serviceToken,
  oc
}: {
  serviceToken: string
  oc: number
}): Promise<AgenceBioNormalizedOperator[]> {
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
  }).json<OperateursPage>()

  if (data.nbTotal === data.operateurs.length) {
    return data.operateurs.map(normalizeOperator)
  }

  const requests: Promise<OperateursPage>[] = []
  for (let page = 1; page * limit < data.nbTotal; page++) {
    requests.push(
      get(`${config.get('notifications.endpoint')}/api/oc/${oc}/operateurs`, {
        headers: {
          Authorization: serviceToken,
          Origin
        },
        searchParams: {
          limit,
          page: page + 1,
          orderBy: 'nom'
        }
      }).json<OperateursPage>()
    )
  }

  return await Promise.all(requests).then((results) => {
    let allData = data.operateurs
    results.forEach((res): void => {
      allData = allData.concat(res.operateurs)
    })

    return allData.map(normalizeOperator)
  })
}

/**
 * Returs operators for admin profile
 */
async function _getOperatorsForAdmin({ serviceToken, input = '' }: { serviceToken: string; input?: string }) {
  const limit = 10000

  type SearchParams = { nom?: string; numeroBio?: string; siret?: string; page?: number }
  const fetchPage = (searchParams: SearchParams) =>
    get(`${config.get('notifications.endpoint')}/api/operateurs/cartobio`, {
      headers: {
        Authorization: serviceToken,
        Origin
      },
      searchParams: { limit, ...searchParams }
    }).json<OperateursPage>()

  const fetchAllPages = async (baseParams: SearchParams) => {
    const data = await fetchPage(baseParams)
    if (data.nbTotal === data.operateurs.length) {
      return data.operateurs
    }

    const requests: Promise<OperateursPage>[] = []
    for (let page = 1; page * limit < data.nbTotal; page++) {
      requests.push(fetchPage({ ...baseParams, page: page + 1 }))
    }

    const results = await Promise.all(requests)
    return results.reduce((all, res) => all.concat(res.operateurs), data.operateurs)
  }

  const isInteger = Number.isInteger(Number(input))

  const results = await Promise.all([
    fetchAllPages({ nom: input }),
    ...(isInteger ? [fetchAllPages({ numeroBio: input }), fetchAllPages({ siret: input })] : [])
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
 */
const getOperatorsByOc = memo(_getOperatorsByOc, {
  maxAge: 10 * ONE_MINUTE,
  cacheKey: JSON.stringify
})

/**
 * Returns operators related to admin, and eventual filters (numeroBio, or pacage)
 */
const getOperatorsForAdmin = memo(_getOperatorsForAdmin, {
  maxAge: 10 * ONE_MINUTE,
  cacheKey: JSON.stringify
})

/**
 * Returns operators for a given user
 */
async function fetchUserOperators(userId: number): Promise<{ operators: AgenceBioNormalizedOperator[] }> {
  const data = await get(`${config.get('notifications.endpoint')}/api/utilisateur/${userId}/operateurs`, {
    headers: {
      Authorization: serviceToken,
      Origin
    }
  }).json<AgenceBioOperator[]>()

  return {
    operators: data.map(normalizeOperator)
  }
}

async function fetchCustomersByOc(oc: number): Promise<OperatorWithNotification[]> {
  return (await getOperatorsByOc({ serviceToken, oc })).filter(hasNotification)
}

async function fetchOperatorsForAdmin(input = ''): Promise<OperatorWithNotification[]> {
  return (await getOperatorsForAdmin({ serviceToken, input })).filter(hasNotification)
}

async function fetchOperatorByNumeroBio(numeroBio: string): Promise<AgenceBioNormalizedOperator> {
  const data = await get(`${config.get('notifications.endpoint')}/api/operateur/${numeroBio}`, {
    headers: {
      Authorization: config.get('notifications.serviceToken'),
      Origin
    }
  }).json<AgenceBioOperator>()
  return normalizeOperator(data)
}

async function fetchEmailForNumeroBio(numeroBio: string): Promise<AgenceBioOperatorEmails> {
  const data = await get(`${config.get('notifications.endpoint')}/api/operateur/${numeroBio}/utilisateurs-emails`, {
    headers: {
      Authorization: config.get('notifications.serviceToken'),
      Origin
    }
  }).json<AgenceBioOperatorEmails>()
  return data
}

async function checkOcToken(token: string): Promise<OrganismeCertificateur> {
  return post(`${config.get('notifications.endpoint')}/api/oc/check-token`, {
    headers: {
      Authorization: serviceToken,
      Origin
    },
    json: { token }
  }).json()
}

function parsePacDetailsFromComment(commentaire?: string | null): {
  numeroIlot: string | null
  numeroParcelle: string | null
} {
  let result: { numeroIlot: string | null; numeroParcelle: string | null } = { numeroIlot: null, numeroParcelle: null }

  const RE = /ilot\s+(?<numeroIlot>\d+)\s+parcelle\s+(?<numeroParcelle>\d+)/i
  const RE_INVERTED = /parcelle\s+(?<numeroParcelle>\d+)\s+ilot\s+(?<numeroIlot>\d+)/i
  const RE_COMPACT = /ilot-(?<numeroIlot>\d+)-(?<numeroParcelle>\d+)/i

  for (const REG of [RE, RE_INVERTED, RE_COMPACT]) {
    const groups = commentaire ? REG.exec(commentaire)?.groups : undefined
    if (groups) {
      result = { numeroIlot: groups.numeroIlot, numeroParcelle: groups.numeroParcelle }
    }
  }

  return result
}

export {
  checkOcToken,
  fetchOperatorByNumeroBio,
  fetchUserOperators,
  fetchCustomersByOc,
  fetchOperatorsForAdmin,
  parsePacDetailsFromComment,
  fetchEmailForNumeroBio
}
