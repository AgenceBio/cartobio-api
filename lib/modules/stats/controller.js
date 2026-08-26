const repo = require('./repository')

/** @typedef {import('./utils').OrdreTri} OrdreTri */
/** @typedef {import('fastify').FastifyRequest<import('./utils').DashboardRoute>} DashboardRequest */

/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<import('fastify').FastifyReply>}
 */
async function getGeneralKpi (
  request,
  reply
) {
  const { from, to } = request.query

  const data = await repo.getGeneralKpi({ from, to })

  return reply.send({ data })
}

/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<import('fastify').FastifyReply>}
 */
async function getTableauBilan (
  request,
  reply
) {
  const {
    from,
    to,
    page = '1',
    limit = '20',
    recherche,
    statuts,
    etats,
    ordreDate
  } = request.query

  const data = await repo.getTableauBilanRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    statuts: statuts ? statuts.split(',').filter(Boolean) : undefined,
    etats: etats ? etats.split(',').filter(Boolean) : undefined,
    ordreDate: ordreDate === 'asc' ? 'asc' : 'desc'
  })

  return reply.send(data)
}
/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<import('fastify').FastifyReply>}
 */
async function getHistoriqueSpecificParcellaire (
  request,
  reply
) {
  const { numeroBio, numeroClient, auditDate } = request.query

  const data = await repo.getHistoriqueSpecificParcellaireRepo({
    numeroBio,
    numeroClient,
    auditDate
  })

  return reply.send(data)
}

/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<import('fastify').FastifyReply>}
 */
async function getHistoriqueImports (
  request,
  reply
) {
  const { from, to, page = '1', limit = '20' } = request.query

  const data = await repo.getHistoriqueImportsRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit)
  })

  return reply.send({ data })
}

/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<import('fastify').FastifyReply>}
 */
async function getTableauErreurs (
  request,
  reply
) {
  const {
    from,
    to,
    page = '1',
    limit = '20',
    recherche,
    ordreDate
  } = request.query
  const ordreDateValue = ordreDate === 'asc' || ordreDate === 'desc' ? ordreDate : undefined

  const data = await repo.getTableauErreursRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche,
    ordreDate: ordreDateValue
  })

  return reply.send(data)
}

/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<import('fastify').FastifyReply>}
 */
async function getTopAnomalies (
  request,
  reply
) {
  const { from, to } = request.query

  const data = await repo.getTopAnomaliesRepo({ from, to })

  return reply.send({ data })
}

/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<import('fastify').FastifyReply>}
 */
async function getTopAnomaliesGrouped (
  request,
  reply
) {
  const { from, to } = request.query

  const data = await repo.getTopAnomaliesGroupedRepo({ from, to })

  return reply.send(data)
}

/**
 * @param {DashboardRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
async function getRepetErreurs (
  request,
  reply
) {
  const {
    from,
    to,
    page = '1',
    limit = '10',
    recherche
  } = request.query

  const data = await repo.getEnvoisSuspectsRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche
  })

  return reply.send(data)
}

module.exports = {
  getGeneralKpi,
  getTableauBilan,
  getHistoriqueImports,
  getTableauErreurs,
  getHistoriqueSpecificParcellaire,
  getTopAnomalies,
  getTopAnomaliesGrouped,
  getRepetErreurs
}