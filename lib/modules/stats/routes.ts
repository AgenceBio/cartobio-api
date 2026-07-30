import type { FastifyPluginAsync } from 'fastify'

import { mergeSchemas, protectedWithToken } from '../../routes'

import * as controller from './controller'

import type { DashboardRoute } from './utils'

const parcellaireRoutes: FastifyPluginAsync = async (
  fastify
): Promise<void> => {
  const auth = protectedWithToken({
    oc: true,
    cartobio: true
  })

  fastify.get<DashboardRoute>(
    '/general-kpi',
    mergeSchemas(auth),
    controller.getGeneralKpi
  )

  fastify.get<DashboardRoute>(
    '/tableau',
    mergeSchemas(auth),
    controller.getTableauBilan
  )

  fastify.get<DashboardRoute>(
    '/tableau-errors',
    mergeSchemas(auth),
    controller.getTableauErreurs
  )

  fastify.get<DashboardRoute>(
    '/historique',
    mergeSchemas(auth),
    controller.getHistoriqueSpecificParcellaire
  )

  fastify.get<DashboardRoute>(
    '/top-anomalies',
    mergeSchemas(auth),
    controller.getTopAnomalies
  )

  fastify.get<DashboardRoute>(
    '/top-anomalies-grouped',
    mergeSchemas(auth),
    controller.getTopAnomaliesGrouped
  )

  fastify.get<DashboardRoute>(
    '/repet-ano',
    mergeSchemas(auth),
    controller.getRepetErreurs
  )
}

export { parcellaireRoutes }
