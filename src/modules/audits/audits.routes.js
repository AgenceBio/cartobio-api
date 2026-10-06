'use strict'

const {
  mergeSchemas,
  protectedWithToken,
  operatorFromNumeroBio,
  operatorFromRecordId,
  routeWithRecordId,
  checkCertificationStatus,
  createFeatureSchema,
  createRecordSchema,
  deleteSingleFeatureSchema,
  patchFeatureCollectionSchema,
  patchRecordSchema,
  updateFeaturePropertiesSchema
} = require('./audits.schema.js')
const { AttestationsProductionsType } = require('../../../src/shared/enums.js')
const service = require('./audits.service.js')

module.exports = async function auditRoutes (app) {
  app.get(
    '/api/v2/audits/:recordId',
    mergeSchemas(protectedWithToken(), operatorFromRecordId),
    (request, reply) => {
      return reply.code(200).send(request.record)
    }
  )

  /**
   * Retrieve a given Record
   */
  app.get('/api/v2/audits/:recordId/has-attestation-production', mergeSchemas(protectedWithToken(), operatorFromRecordId), async (request, reply) => {
    const pac = (request.query.pac ?? 'false') === 'true'

    const attestation = await service.getAttestationProduction(request.record.record_id, pac ? AttestationsProductionsType.PACCOMPLET : AttestationsProductionsType.COMPLET)

    return reply.code(200).send({ hasAttestationProduction: !!attestation })
  })

  /**
   * @private
   * Marque une parcelle comme controlée
   */
  app.post(
    '/api/v2/audits/:recordId/:id/controlee',
    mergeSchemas(protectedWithToken(), operatorFromRecordId),
    async (request, reply) => {
      await service.markFeatureControlled(
        request.params.recordId,
        request.params.id,
        request.user.id
      )

      return reply.code(200).send({ controlee: true })
    }
  )

  /**
   * @private
   * Marque une parcelle comme non controlée
   */
  app.post(
    '/api/v2/audits/:recordId/:id/non-controlee',
    mergeSchemas(protectedWithToken(), operatorFromRecordId),
    async (request, reply) => {
      await service.markFeatureUncontrolled(
        request.params.recordId,
        request.params.id,
        request.user.id
      )

      return reply.code(200).send({ controlee: false })
    }
  )

  /**
   * Create a new Record for a given Operator
   */
  app.post(
    '/api/v2/operator/:numeroBio/records',
    mergeSchemas(
      createRecordSchema,
      operatorFromNumeroBio,
      checkCertificationStatus,
      protectedWithToken()
    ),
    async (request, reply) => {
      const { numeroBio } = request.params
      const { id: ocId, nom: ocLabel } =
        request.operator.organismeCertificateur
      const record = await service.createOrUpdateOperatorRecord(
        {
          numerobio: numeroBio,
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

  /**
   * Delete a given Record
   */
  app.delete(
    '/api/v2/audits/:recordId',
    mergeSchemas(protectedWithToken(), routeWithRecordId),
    async (request, reply) => {
      const { user, record } = request
      await service.deleteRecord({ user, record })
      return reply.code(204).send()
    }
  )

  /**
   * Partial update Record's metadata (top-level properties except features)
   * It also keep track of new HistoryEvent along the way, depending who and when you update feature properties
   */
  app.patch(
    '/api/v2/audits/:recordId',
    mergeSchemas(
      protectedWithToken(),
      patchRecordSchema,
      operatorFromRecordId,
      routeWithRecordId
    ),
    (request, reply) => {
      const { body: patch, user, record, operator } = request

      return service.updateAuditRecordState({ user, record, operator }, patch).then(
        (record) => reply.code(200).send(service.normalizeRecord(record))
      )
    }
  )

  /**
   * Add new feature entries to an existing collection
   */
  app.post(
    '/api/v2/audits/:recordId/parcelles',
    mergeSchemas(
      protectedWithToken(),
      createFeatureSchema,
      routeWithRecordId,
      operatorFromRecordId
    ),
    (request, reply) => {
      const { feature } = request.body
      const { user, record, operator } = request

      return service.addRecordFeature({ user, record, operator }, feature).then(
        (record) => reply.code(200).send(service.normalizeRecord(record))
      )
    }
  )

  /**
   * Get features of specific record id
   */
  app.get(
    '/api/v2/audits/:recordId/parcelles',
    mergeSchemas(protectedWithToken(), operatorFromRecordId),
    (request, reply) => {
      const { record } = request
      return reply.code(200).send(record.parcelles)
    }
  )

  /**
   * Partial update a feature collection (ie: mass action from the collection screen)
   *
   * Matching features are updated, features not present in payload or database are ignored
   */
  app.patch(
    '/api/v2/audits/:recordId/parcelles',
    mergeSchemas(
      protectedWithToken(),
      patchFeatureCollectionSchema,
      routeWithRecordId,
      operatorFromRecordId
    ),
    (request, reply) => {
      const { body: featureCollection, user, record, operator } = request

      return service.patchFeatureCollection(
        { user, record, operator },
        featureCollection.features
      ).then((record) => reply.code(200).send(service.normalizeRecord(record)))
    }
  )

  /**
   * Partial update a single feature (ie: feature form from an editing modal)
   *
   * Absent properties are kept as is, new properties are added, existing properties are updated
   * ('culture' field is not a special case, it's just a regular property that can be replaced)
   */
  app.patch(
    '/api/v2/audits/:recordId/parcelles/:featureId',
    mergeSchemas(
      protectedWithToken(),
      updateFeaturePropertiesSchema,
      routeWithRecordId,
      operatorFromRecordId
    ),
    (request, reply) => {
      const { body: feature, user, record, operator } = request
      const { featureId } = request.params

      return service.updateFeature({ featureId, user, record, operator }, feature).then(
        (record) => reply.code(200).send(service.normalizeRecord(record))
      )
    }
  )

  /**
   * Delete a single feature
   */
  app.delete(
    '/api/v2/audits/:recordId/parcelles/:featureId',
    mergeSchemas(
      protectedWithToken(),
      deleteSingleFeatureSchema,
      routeWithRecordId,
      operatorFromRecordId
    ),
    (request, reply) => {
      const { user, record, operator } = request
      const { reason } = request.body
      const { featureId } = request.params

      return service.deleteSingleFeature(
        { featureId, user, record, operator },
        { reason }
      ).then((record) => reply.code(200).send(service.normalizeRecord(record)))
    }
  )

  app.put(
    '/api/v2/audits/:recordId/parcelles',
    mergeSchemas(protectedWithToken(), routeWithRecordId, operatorFromRecordId),
    (request, reply) => {
      const { user, record, operator } = request
      const { features, from } = request.body

      return service.createFeaturesFromOther(
        user,
        record,
        operator,
        features,
        from
      ).then((record) => reply.code(200).send(service.normalizeRecord(record)))
    }
  )
}
