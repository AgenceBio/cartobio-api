import { access } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  attestationProductionSchema,
  createFeatureSchema,
  createFeaturesFromOtherSchema,
  createRecordSchema,
  deleteRecordSchema,
  deleteSingleFeatureSchema,
  getFeaturesSchema,
  getRecordSchema,
  markControlledSchema,
  markUncontrolledSchema,
  patchFeatureCollectionSchema,
  patchRecordSchema,
  updateFeaturePropertiesSchema
} from './audits.schema.js'
import { AttestationsProductionsType } from '@agencebio/cartobio-types'
import type { FeatureInput } from '@agencebio/cartobio-types'
import * as service from './audits.service.js'
import { createOrUpdateOperatorRecord } from '../../shared/parcellaires/parcellaires.service.js'
import { requireOperator, requireRecord, requireUser } from '../../shared/request.js'
import { NotFoundApiError } from '../../shared/errors.js'
import { outputRecord } from './audits.utils.js'

export default async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  app.get('/api/v2/audits/:recordId', getRecordSchema, async (request, reply) => {
    return reply.code(200).send(requireRecord(request))
  })

  app.get(
    '/api/v2/audits/:recordId/has-attestation-production',
    attestationProductionSchema,
    async (request, reply) => {
      const { pac } = request.query

      const attestation = await service.getAttestationProduction(
        requireRecord(request).record_id,
        pac ? AttestationsProductionsType.PACCOMPLET : AttestationsProductionsType.COMPLET
      )

      const fileExists = attestation
        ? await access(attestation.path).then(
            () => true,
            () => false
          )
        : false

      return reply.code(200).send({ hasAttestationProduction: fileExists })
    }
  )

  app.post('/api/v2/audits/:recordId/:id/controlee', markControlledSchema, async (request, reply) => {
    if (!requireRecord(request).parcelles.features.some(({ id }) => id === request.params.id))
      throw new NotFoundApiError('Parcelle introuvable')
    await service.markFeatureControlled(request.params.recordId, request.params.id, requireUser(request).id)

    return reply.code(200).send({ controlee: true })
  })

  app.post('/api/v2/audits/:recordId/:id/non-controlee', markUncontrolledSchema, async (request, reply) => {
    if (!requireRecord(request).parcelles.features.some(({ id }) => id === request.params.id))
      throw new NotFoundApiError('Parcelle introuvable')
    await service.markFeatureUncontrolled(request.params.recordId, request.params.id, requireUser(request).id)

    return reply.code(200).send({ controlee: false })
  })

  app.post('/api/v2/operator/:numeroBio/records', createRecordSchema, async (request, reply) => {
    const { numeroBio } = request.params
    const { id: ocId, nom: ocLabel, numeroClient } = requireOperator(request).organismeCertificateur
    const record = await createOrUpdateOperatorRecord(
      {
        ...request.body,
        numerobio: String(numeroBio),
        oc_id: ocId,
        oc_label: ocLabel,
        numero_client: numeroClient
      },
      {
        user: request.user,
        copyParcellesData: request.body.importPrevious,
        previousRecordId: request.body.recordId
      }
    )
    return reply.code(200).send(outputRecord(request.user, record, request.operator))
  })

  app.delete('/api/v2/audits/:recordId', deleteRecordSchema, async (request, reply) => {
    await service.deleteRecord(requireRecord(request))
    return reply.code(204).send()
  })

  app.patch('/api/v2/audits/:recordId', patchRecordSchema, async (request, reply) => {
    const { body: patch, operator } = request

    const record = await service.updateAuditRecordState(
      {
        user: requireUser(request),
        record: requireRecord(request),
        operator,
        ifUnmodifiedSince: request.headers['if-unmodified-since']
      },
      patch
    )
    return reply.code(200).send(outputRecord(request.user, record, request.operator))
  })

  app.post('/api/v2/audits/:recordId/parcelles', createFeatureSchema, async (request, reply) => {
    const { feature } = request.body
    const { user, operator } = request

    const record = await service.addRecordFeature(
      {
        user,
        record: requireRecord(request),
        operator,
        ifUnmodifiedSince: request.headers['if-unmodified-since']
      },
      feature
    )
    return reply.code(200).send(outputRecord(request.user, record, request.operator))
  })

  app.get('/api/v2/audits/:recordId/parcelles', getFeaturesSchema, async (request, reply) => {
    return reply.code(200).send(requireRecord(request).parcelles)
  })

  app.patch('/api/v2/audits/:recordId/parcelles', patchFeatureCollectionSchema, async (request, reply) => {
    const { body: featureCollection, user, operator } = request

    const record = await service.patchFeatureCollection(
      {
        user,
        record: requireRecord(request),
        operator,
        ifUnmodifiedSince: request.headers['if-unmodified-since']
      },
      featureCollection.features ?? []
    )
    return reply.code(200).send(outputRecord(request.user, record, request.operator))
  })

  app.patch('/api/v2/audits/:recordId/parcelles/:featureId', updateFeaturePropertiesSchema, async (request, reply) => {
    const { body: feature, user, operator } = request
    const { featureId } = request.params

    const record = await service.updateFeature(
      {
        featureId,
        user,
        record: requireRecord(request),
        operator,
        ifUnmodifiedSince: request.headers['if-unmodified-since']
      },
      feature
    )
    return reply.code(200).send(outputRecord(request.user, record, request.operator))
  })

  app.delete('/api/v2/audits/:recordId/parcelles/:featureId', deleteSingleFeatureSchema, async (request, reply) => {
    const { operator } = request
    const { reason } = request.body
    const { featureId } = request.params

    const record = await service.deleteSingleFeature(
      {
        featureId,
        user: requireUser(request),
        record: requireRecord(request),
        operator,
        ifUnmodifiedSince: request.headers['if-unmodified-since']
      },
      { reason }
    )
    return reply.code(200).send(outputRecord(request.user, record, request.operator))
  })

  app.put('/api/v2/audits/:recordId/parcelles', createFeaturesFromOtherSchema, async (request, reply) => {
    const { user, operator } = request
    const { features, from } = request.body

    const record = await service.createFeaturesFromOther(
      user,
      requireRecord(request),
      operator,
      features as FeatureInput[],
      from as Array<string | number>,
      request.headers['if-unmodified-since']
    )
    return reply.code(200).send(outputRecord(request.user, record, request.operator))
  })
}
