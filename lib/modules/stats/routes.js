'use strict'
const { mergeSchemas, protectedWithToken } = require('../../routes/index.js')

const controller = require('./controller')

async function parcellaireRoutes (fastify, options) {
  fastify.get(
    '/:organismeCertificateur/bilan',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getBilanPeriode)

  fastify.get(
    '/:organismeCertificateur/bilan/granularite',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getBilanParGranularite
  )

  fastify.get(
    '/:organismeCertificateur/resume-semaine',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getResumeSemaine
  )

  fastify.get(
    '/:organismeCertificateur/tableau',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getTableauBilan
  )

  fastify.get(
    '/:organismeCertificateur/historique',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getHistoriqueImports
  )

  fastify.get(
    '/:organismeCertificateur/import/:jobId/payload',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getPayloadImport
  )

  fastify.get(
    '/:organismeCertificateur/tableau/erreurs',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getTableauErreurs
  )

  fastify.get(
    '/:organismeCertificateur/envois-refuses',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    controller.getEnvoisRefuses
  )
}

module.exports = { parcellaireRoutes }