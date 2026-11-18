import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { generalKpiSchema, historiqueSchema, repetitionsSchema, tableauBilanSchema, tableauErreursSchema, topAnomaliesGroupedSchema, topAnomaliesSchema } from './tableau-de-bord.schema.js'
import * as service from './tableau-de-bord.service.js'

function getOrganismeCertificateurId (request: FastifyRequest): number | undefined {
  return request.organismeCertificateur?.id ?? request.user?.organismeCertificateur?.id
}

export default async function tableauDeBordRoutes (fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/general-kpi', generalKpiSchema, async (request, reply) => {
    const data = await service.getGeneralKpi(request.query, getOrganismeCertificateurId(request))
    return reply.send({ data })
  })

  app.get('/tableau', tableauBilanSchema, async (request, reply) => {
    return reply.send(await service.getTableauBilan(request.query, getOrganismeCertificateurId(request)))
  })

  app.get('/tableau-errors', tableauErreursSchema, async (request, reply) => {
    return reply.send(await service.getTableauErreurs(request.query, getOrganismeCertificateurId(request)))
  })

  app.get('/historique', historiqueSchema, async (request, reply) => {
    return reply.send(await service.getHistoriqueSpecificParcellaire(request.query, getOrganismeCertificateurId(request)))
  })

  app.get('/top-anomalies', topAnomaliesSchema, async (request, reply) => {
    const data = await service.getTopAnomalies(request.query, getOrganismeCertificateurId(request))
    return reply.send({ data })
  })

  app.get('/top-anomalies-grouped', topAnomaliesGroupedSchema, async (request, reply) => {
    return reply.send(await service.getTopAnomaliesGrouped(request.query, getOrganismeCertificateurId(request)))
  })

  app.get('/repet-ano', repetitionsSchema, async (request, reply) => {
    return reply.send(await service.getRepetErreurs(request.query, getOrganismeCertificateurId(request)))
  })
}
