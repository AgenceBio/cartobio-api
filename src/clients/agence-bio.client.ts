import memo from 'p-memoize'
import gotModule from 'got'
const got = gotModule.default
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
import { z } from 'zod'
const Origin = config.get('notifications.origin')
const serviceToken: string = config.get('notifications.serviceToken')

const ONE_MINUTE = 60 * 1000

type OperatorWithNotification = AgenceBioNormalizedOperator & { notifications: AgenceBioNotification }

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
  const data = parseApiResponse(
    agenceBioOperateursPageSchema,
    await get(`${config.get('notifications.endpoint')}/api/oc/${oc}/operateurs`, {
      headers: {
        Authorization: serviceToken,
        Origin
      },
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
async function _getOperatorsForAdmin({
  serviceToken,
  input = ''
}: {
  serviceToken: string
  input?: string
}): Promise<AgenceBioNormalizedOperator[]> {
  const limit = 10000

  type SearchParams = { nom?: string; numeroBio?: string; siret?: string; page?: number }
  const fetchPage = async (searchParams: SearchParams): Promise<AgenceBioOperateursPage> =>
    parseApiResponse(
      agenceBioOperateursPageSchema,
      await get(`${config.get('notifications.endpoint')}/api/operateurs/cartobio`, {
        headers: {
          Authorization: serviceToken,
          Origin
        },
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
  const data = parseApiResponse(
    z.array(agenceBioOperatorSchema),
    await get(`${config.get('notifications.endpoint')}/api/utilisateur/${userId}/operateurs`, {
      headers: {
        Authorization: serviceToken,
        Origin
      }
    }).json(),
    "l'API Agence Bio"
  )

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
  const data = parseApiResponse(
    agenceBioOperatorSchema,
    await get(`${config.get('notifications.endpoint')}/api/operateur/${numeroBio}`, {
      headers: {
        Authorization: config.get('notifications.serviceToken'),
        Origin
      }
    }).json(),
    "l'API Agence Bio"
  )
  return normalizeOperator(data)
}

async function fetchEmailForNumeroBio(numeroBio: string): Promise<AgenceBioOperatorEmails> {
  const data = parseApiResponse(
    agenceBioOperatorEmailsSchema,
    await get(`${config.get('notifications.endpoint')}/api/operateur/${numeroBio}/utilisateurs-emails`, {
      headers: {
        Authorization: config.get('notifications.serviceToken'),
        Origin
      }
    }).json(),
    "l'API Agence Bio"
  )
  return data
}

async function checkOcToken(token: string): Promise<OrganismeCertificateur> {
  return parseApiResponse(
    organismeCertificateurSchema,
    await post(`${config.get('notifications.endpoint')}/api/oc/check-token`, {
      headers: {
        Authorization: serviceToken,
        Origin
      },
      json: { token }
    }).json(),
    "l'API Agence Bio"
  )
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
