const { mergeSchemas, protectedWithToken } = require('../../routes')
const controller = require('./controller')

/** @typedef {import('./utils').DashboardRoute} DashboardRoute */

/** @type {import('fastify').FastifyPluginAsync} */
const parcellaireRoutes = async (
  fastify
) => {
  const auth = protectedWithToken({
    oc: true,
    cartobio: true
  })

  fastify.get(
    '/general-kpi',
    mergeSchemas(auth),
    controller.getGeneralKpi
  )

  fastify.get(
    '/tableau',
    mergeSchemas(auth),
    controller.getTableauBilan
  )

  fastify.get(
    '/tableau-errors',
    mergeSchemas(auth),
    controller.getTableauErreurs
  )

  fastify.get(
    '/historique',
    mergeSchemas(auth),
    controller.getHistoriqueSpecificParcellaire
  )

  fastify.get(
    '/top-anomalies',
    mergeSchemas(auth),
    controller.getTopAnomalies
  )

  fastify.get(
    '/top-anomalies-grouped',
    mergeSchemas(auth),
    controller.getTopAnomaliesGlobal
  )

  fastify.get(
    '/repet-ano',
    mergeSchemas(auth),
    controller.getRepetErreurs
  )

}

module.exports = { parcellaireRoutes }