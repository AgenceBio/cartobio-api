import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { exportPdfSchema, exportParcellaireSchema } from './exports.schema.js'
import * as service from './exports.service.js'
import { requireOcUser, requireRecord } from '../../shared/request.js'
import { InvalidRequestApiError, NotFoundApiError } from '../../shared/errors.js'
import { CertificationState } from '@agencebio/cartobio-types'

export default async function exportRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  app.get('/api/v2/pdf/:numeroBio/:recordId', exportPdfSchema, async (request, reply) => {
    const { force_refresh: force, pac, zip } = request.query

    if (String(requireRecord(request).numerobio) !== request.params.numeroBio) {
      throw new NotFoundApiError('Parcellaire introuvable')
    }
    if (requireRecord(request).certification_state !== CertificationState.CERTIFIED) {
      throw new InvalidRequestApiError("L'attestation n'est disponible que pour un parcellaire certifié.")
    }

    request.log.info(
      { audit: 'export-pdf', userId: request.user?.id, recordId: request.params.recordId },
      'Export PDF du parcellaire'
    )
    const generator = service.generatePDF(request.params.numeroBio, request.params.recordId, force, pac, zip)
    const numberParcelle = (await generator.next()).value
    if ((numberParcelle as number) > 80) {
      reply.code(204).send()
      generator.next().catch((err) => request.log.error({ err }, 'Génération PDF en tâche de fond en échec'))
      return reply
    }

    const document = (await generator.next()).value
    if (typeof document !== 'string') throw new Error('Le document généré est invalide')
    reply.header('Content-Type', 'application/zip')
    return reply.code(200).send(document)
  })

  app.post('/api/v2/exportParcellaire', exportParcellaireSchema, async (request, reply) => {
    const user = requireOcUser(request)
    const data = await service.exportDataOcId(user.organismeCertificateur.id, request.body.payload, user.id)
    request.log.info(
      {
        audit: 'export-xlsx',
        userId: user.id,
        ocId: user.organismeCertificateur.id,
        count: data.length
      },
      "Export des parcellaires de l'OC"
    )
    return reply.code(200).send(data)
  })
}
