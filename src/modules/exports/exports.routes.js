'use strict'

const { exportPdfSchema, exportParcellaireSchema } = require('./exports.schema.js')
const service = require('./exports.service.js')

module.exports = async function exportRoutes (app) {
  app.get('/api/v2/pdf/:numeroBio/:recordId', exportPdfSchema, async (request, reply) => {
    const force = (request.query.force_refresh ?? 'false') === 'true'
    const pac = (request.query.pac ?? 'false') === 'true'
    const zip = (request.query.zip ?? 'false') === 'true'

    try {
      const generator = service.generatePDF(request.params.numeroBio, request.params.recordId, force, pac, zip)
      const numberParcelle = (await generator.next()).value
      if (numberParcelle > 80) return reply.code(204).send()

      const document = (await generator.next()).value
      reply.header('Content-Type', zip ? 'application/zip' : 'application/zip')
      return reply.code(200).send(document)
    } catch (error) {
      return reply.code(400).send({ message: error.message })
    }
  })

  app.post('/api/v2/exportParcellaire', exportParcellaireSchema, async (request, reply) => {
    const data = await service.exportDataOcId(
      request.user.organismeCertificateur.id,
      request.body.payload,
      request.user.id
    )
    if (data === null) throw new Error("Une erreur s'est produite, impossible d'exporter les parcellaires")
    return reply.code(200).send(data)
  })
}
