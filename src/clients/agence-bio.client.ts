import memo from 'p-memoize'
import ExpiryMap from 'expiry-map'
import got from 'got'
const { get, post } = got
import { normalizeOperator } from '../shared/outputs/operator.js'

import config from '../config/env.js'
import { organismeCertificateurSchema } from '@agencebio/cartobio-types'
import type { AgenceBioNormalizedOperator, OrganismeCertificateur } from '@agencebio/cartobio-types'
import {
  agenceBioOperateursPageSchema,
  agenceBioOperatorEmailsSchema,
  agenceBioOperatorSchema
} from './agence-bio.types.js'
import type {
  AgenceBioOperateursPage,
  AgenceBioOperator,
  AgenceBioOperatorEmails,
  AgenceBioNotification
} from './agence-bio.types.js'
import { parseApiResponse } from './clients.utils.js'
import { HTTP_TIMEOUT } from './clients.utils.js'
import { z } from 'zod'
const Origin = config.get('notifications.origin')
const serviceToken: string = config.get('notifications.serviceToken')

const ONE_MINUTE = 60 * 1000
const endpoint = (path: string): string => `${config.get('notifications.endpoint')}${path}`
const requestOptions = { timeout: HTTP_TIMEOUT, headers: { Authorization: serviceToken, Origin } }

type OperatorWithNotification = AgenceBioNormalizedOperator & { notifications: AgenceBioNotification }

function hasNotification(operator: AgenceBioNormalizedOperator): operator is OperatorWithNotification {
  return operator.notifications != null
}

/**
 * Returns operators related to an OC
 */
async function _getOperatorsByOc({ oc }: { oc: number }): Promise<AgenceBioNormalizedOperator[]> {
  const limit = 10000
  const data = parseApiResponse(
    agenceBioOperateursPageSchema,
    await get(endpoint(`/api/oc/${oc}/operateurs`), {
      ...requestOptions,
      searchParams: {
        limit,
        orderBy: 'nom'
      }
    }).json(),
    "l'API Agence Bio"
  )

  if (data.nbTotal === data.operateurs.length) {
    return data.operateurs.map(normalizeOperator)
  }

  const requests: Promise<AgenceBioOperateursPage>[] = []
  for (let page = 1; page * limit < data.nbTotal; page++) {
    requests.push(
      get(endpoint(`/api/oc/${oc}/operateurs`), {
        ...requestOptions,
        searchParams: {
          limit,
          page: page + 1,
          orderBy: 'nom'
        }
      })
        .json()
        .then((page) => parseApiResponse(agenceBioOperateursPageSchema, page, "l'API Agence Bio"))
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
async function _getOperatorsForAdmin({ input = '' }: { input?: string }): Promise<AgenceBioNormalizedOperator[]> {
  const limit = 10000

  type SearchParams = { nom?: string; numeroBio?: string; siret?: string; page?: number }
  const fetchPage = async (searchParams: SearchParams): Promise<AgenceBioOperateursPage> =>
    parseApiResponse(
      agenceBioOperateursPageSchema,
      await get(endpoint('/api/operateurs/cartobio'), {
        ...requestOptions,
        searchParams: { limit, ...searchParams }
      }).json(),
      "l'API Agence Bio"
    )

  const fetchAllPages = async (baseParams: SearchParams): Promise<AgenceBioOperator[]> => {
    const data = await fetchPage(baseParams)
    if (data.nbTotal === data.operateurs.length) {
      return data.operateurs
    }

    const requests: Promise<AgenceBioOperateursPage>[] = []
    for (let page = 1; page * limit < data.nbTotal; page++) {
      requests.push(fetchPage({ ...baseParams, page: page + 1 }))
    }

    const results = await Promise.all(requests)
    return results.reduce((all, res) => all.concat(res.operateurs), data.operateurs)
  }

  const isInteger = input !== '' && Number.isInteger(Number(input))

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
  cache: new ExpiryMap(10 * ONE_MINUTE),
  cacheKey: JSON.stringify
})

/**
 * Returns operators related to admin, and eventual filters (numeroBio, or pacage)
 */
const getOperatorsForAdmin = memo(_getOperatorsForAdmin, {
  cache: new ExpiryMap(10 * ONE_MINUTE),
  cacheKey: JSON.stringify
})

/**
 * Returns operators for a given user
 */
async function fetchUserOperators(userId: number): Promise<{ operators: AgenceBioNormalizedOperator[] }> {
  const data = parseApiResponse(
    z.array(agenceBioOperatorSchema),
    await get(endpoint(`/api/utilisateur/${encodeURIComponent(userId)}/operateurs`), requestOptions).json(),
    "l'API Agence Bio"
  )

  return {
    operators: data.map(normalizeOperator)
  }
}

async function fetchCustomersByOc(oc: number): Promise<OperatorWithNotification[]> {
  return (await getOperatorsByOc({ oc })).filter(hasNotification)
}

async function fetchOperatorsForAdmin(input = ''): Promise<OperatorWithNotification[]> {
  return (await getOperatorsForAdmin({ input })).filter(hasNotification)
}

async function fetchOperatorByNumeroBio(numeroBio: string): Promise<AgenceBioNormalizedOperator> {
  const data = parseApiResponse(
    agenceBioOperatorSchema,
    await get(endpoint(`/api/operateur/${encodeURIComponent(numeroBio)}`), requestOptions).json(),
    "l'API Agence Bio"
  )
  return normalizeOperator(data)
}

async function fetchEmailForNumeroBio(numeroBio: string): Promise<AgenceBioOperatorEmails> {
  const data = parseApiResponse(
    agenceBioOperatorEmailsSchema,
    await get(endpoint(`/api/operateur/${encodeURIComponent(numeroBio)}/utilisateurs-emails`), requestOptions).json(),
    "l'API Agence Bio"
  )
  return data
}

async function fetchOcToken(token: string): Promise<OrganismeCertificateur> {
  return parseApiResponse(
    organismeCertificateurSchema,
    await post(endpoint('/api/oc/check-token'), {
      ...requestOptions,
      json: { token }
    }).json(),
    "l'API Agence Bio"
  )
}

const checkOcToken =
  config.get('env') === 'test' ? fetchOcToken : memo(fetchOcToken, { cache: new ExpiryMap(5 * ONE_MINUTE) })

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
      result = { numeroIlot: groups.numeroIlot ?? null, numeroParcelle: groups.numeroParcelle ?? null }
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
