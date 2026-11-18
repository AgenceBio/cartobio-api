import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  attestationProductionSchema, createFeatureSchema, createFeaturesFromOtherSchema, createRecordSchema, deleteRecordSchema,
  deleteSingleFeatureSchema, getFeaturesSchema, getRecordSchema, markControlledSchema, markUncontrolledSchema, patchFeatureCollectionSchema, patchRecordSchema, updateFeaturePropertiesSchema
} from './audits.schema.js'
import { AttestationsProductionsType } from '@agencebio/cartobio-types'
import type { FeatureInput } from '@agencebio/cartobio-types'
import * as service from './audits.service.js'
import { requireOperator, requireRecord, requireUser } from '../../shared/request.js'

export default async function auditRoutes (fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  app.get(
    '/api/v2/audits/:recordId',
    getRecordSchema,
    async (request, reply) => {
      return reply.code(200).send(requireRecord(request))
    }
  )

  app.get('/api/v2/audits/:recordId/has-attestation-production', attestationProductionSchema, async (request, reply) => {
    const pac = (request.query.pac ?? 'false') === 'true'

    const attestation = await service.getAttestationProduction(requireRecord(request).record_id, pac ? AttestationsProductionsType.PACCOMPLET : AttestationsProductionsType.COMPLET)

    return reply.code(200).send({ hasAttestationProduction: !!attestation })
  })

  app.post(
    '/api/v2/audits/:recordId/:id/controlee',
    markControlledSchema,
    async (request, reply) => {
      await service.markFeatureControlled(
        request.params.recordId,
        request.params.id,
        requireUser(request).id
      )

      return reply.code(200).send({ controlee: true })
    }
  )

  app.post(
    '/api/v2/audits/:recordId/:id/non-controlee',
    markUncontrolledSchema,
    async (request, reply) => {
      await service.markFeatureUncontrolled(
        request.params.recordId,
        request.params.id,
        requireUser(request).id
      )

      return reply.code(200).send({ controlee: false })
    }
  )

  app.post(
    '/api/v2/operator/:numeroBio/records',
    createRecordSchema,
    async (request, reply) => {
      const { numeroBio } = request.params
      const { id: ocId, nom: ocLabel } =
        requireOperator(request).organismeCertificateur
      const record = await service.createOrUpdateOperatorRecord(
        {
          numerobio: String(numeroBio),
          oc_id: ocId,
          oc_label: ocLabel,
          ...request.body
        },
        {
          user: request.user,
          copyParcellesData: request.body.importPrevious,
          previousRecordId: request.body.recordId
        }
      )
      return reply.code(200).send(service.normalizeRecord(record))
    }
  )

  app.delete(
    '/api/v2/audits/:recordId',
    deleteRecordSchema,
    async (request, reply) => {
      await service.deleteRecord({ user: requireUser(request), record: requireRecord(request) })
      return reply.code(204).send()
    }
  )

  app.patch(
    '/api/v2/audits/:recordId',
    patchRecordSchema,
    async (request, reply) => {
      const { body: patch, operator } = request

      const record = await service.updateAuditRecordState({ user: requireUser(request), record: requireRecord(request), operator }, patch)
      return reply.code(200).send(service.normalizeRecord(record))
    }
  )

  app.post(
    '/api/v2/audits/:recordId/parcelles',
    createFeatureSchema,
    async (request, reply) => {
      const { feature } = request.body
      const { user, operator } = request

      const record = await service.addRecordFeature({ user, record: requireRecord(request), operator }, feature)
      return reply.code(200).send(service.normalizeRecord(record))
    }
  )

  app.get(
    '/api/v2/audits/:recordId/parcelles',
    getFeaturesSchema,
    async (request, reply) => {
      return reply.code(200).send(requireRecord(request).parcelles)
    }
  )

  app.patch(
    '/api/v2/audits/:recordId/parcelles',
    patchFeatureCollectionSchema,
    async (request, reply) => {
      const { body: featureCollection, user, operator } = request

      const record = await service.patchFeatureCollection(
        { user, record: requireRecord(request), operator },
        featureCollection.features ?? []
      )
      return reply.code(200).send(service.normalizeRecord(record))
    }
  )

  app.patch(
    '/api/v2/audits/:recordId/parcelles/:featureId',
    updateFeaturePropertiesSchema,
    async (request, reply) => {
      const { body: feature, user, operator } = request
      const { featureId } = request.params

      const record = await service.updateFeature({ featureId, user, record: requireRecord(request), operator }, feature)
      return reply.code(200).send(service.normalizeRecord(record))
    }
  )

  app.delete(
    '/api/v2/audits/:recordId/parcelles/:featureId',
    deleteSingleFeatureSchema,
    async (request, reply) => {
      const { operator } = request
      const { reason } = request.body
      const { featureId } = request.params

      const record = await service.deleteSingleFeature(
        { featureId, user: requireUser(request), record: requireRecord(request), operator },
        { reason }
      )
      return reply.code(200).send(service.normalizeRecord(record))
    }
  )

  app.put(
    '/api/v2/audits/:recordId/parcelles',
    createFeaturesFromOtherSchema,
    async (request, reply) => {
      const { user, operator } = request
      const { features, from } = request.body

      const record = await service.createFeaturesFromOther(
        user,
        requireRecord(request),
        operator,
        features as FeatureInput[],
        from as Array<string | number>
      )
      return reply.code(200).send(service.normalizeRecord(record))
    }
  )
}
