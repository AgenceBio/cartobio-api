import { OrdreTri } from './utils'
import type { FastifyReply, FastifyRequest } from 'fastify'
import * as repo from './repository'
import type { DashboardRoute } from './utils'

type DashboardRequest = FastifyRequest<DashboardRoute>;

async function getGeneralKpi (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { from, to } = request.query

  const data = await repo.getGeneralKpi({ from, to })

  return reply.send({ data })
}

async function getTableauBilan (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
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
async function getHistoriqueSpecificParcellaire (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { numeroBio, numeroClient, auditDate } = request.query

  const data = await repo.getHistoriqueSpecificParcellaireRepo({
    numeroBio,
    numeroClient,
    auditDate
  })

  return reply.send(data)
}

async function getHistoriqueImports (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { from, to, page = '1', limit = '20' } = request.query

  const data = await repo.getHistoriqueImportsRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit)
  })

  return reply.send({ data })
}

async function getTableauErreurs (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const {
    from,
    to,
    page = '1',
    limit = '20',
    recherche,
    ordreDate
  } = request.query
  const ordreDateValue = ordreDate === 'asc' || ordreDate === 'desc' ? ordreDate as OrdreTri : undefined

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

async function getTopAnomalies (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { from, to } = request.query

  const data = await repo.getTopAnomaliesRepo({ from, to })

  return reply.send({ data })
}

async function getTopAnomaliesGrouped (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { from, to } = request.query

  const data = await repo.getTopAnomaliesGroupedRepo({ from, to })

  return reply.send(data)
}

async function getRepetErreurs (
  request: DashboardRequest,
  reply: FastifyReply
): Promise<void> {
  const {
    from,
    to,
    page = '1',
    limit = '10',
    recherche
  } = request.query as Record<string, string | undefined>

  const data = await repo.getEnvoisSuspectsRepo({
    from,
    to,
    page: Number(page),
    limit: Number(limit),
    recherche
  })

  return reply.send(data)
}

export {
  getGeneralKpi,
  getTableauBilan,
  getHistoriqueImports,
  getTableauErreurs,
  getHistoriqueSpecificParcellaire,
  getTopAnomalies,
  getTopAnomaliesGrouped,
  getRepetErreurs
}
