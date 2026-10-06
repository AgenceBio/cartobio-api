'use strict'

const stripBom = require('strip-bom-stream')
const { PassThrough } = require('node:stream')
const {
  mergeSchemas,
  protectedWithToken,
  operatorFromNumeroBio,
  routeWithPacage,
  geofoliaImportSchema
} = require('./imports.schema.js')
const { InvalidRequestApiError, NotFoundApiError, UnauthorizedApiError } = require('../../../src/shared/errors.js')
const service = require('./imports.service.js')

module.exports = async function importRoutes (app) {
  /**
   * Turn a Telepac XML or Telepac zipped Shapefile into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post(
    '/api/v2/convert/telepac/geojson',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    async (request, reply) => {
      return service.parseTelepacArchive(request.file()).then((geojson) =>
        reply.send(geojson)
      )
    }
  )

  /**
   * Turn a Geofolia file into a workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post(
    '/api/v2/convert/geofolia/geojson',
    mergeSchemas(protectedWithToken()),
    async (request, reply) => {
      const data = await request.file()

      return service.parseGeofoliaArchive(await data.toBuffer()).then((geojson) =>
        reply.send(geojson)
      )
    }
  )

  /**
   * Turn a geographical file workeable FeatureCollection
   * It's essentially used during an import process to preview its content
   * @private
   */
  app.post(
    '/api/v2/convert/anygeo/geojson',
    mergeSchemas(protectedWithToken()),
    async (request, reply) => {
      return service.parseAnyGeographicalArchive(request.file()).then((geojson) =>
        reply.send(geojson)
      )
    }
  )

  /**
   * Retrieves all features associated to a PACAGE as a workeable FeatureCollection
   */
  app.get(
    '/api/v2/import/pacage/:numeroPacage',
    mergeSchemas(
      protectedWithToken({ cartobio: true, oc: true }),
      routeWithPacage
    ),
    async (request, reply) => {
      const { numeroPacage } = request.params

      return service.pacageLookup({ numeroPacage }).then((featureCollection) =>
        reply.send(featureCollection)
      )
    }
  )

  /**
   * Checks if an operator has Geofolink features
   * It triggers a data order, which has the benefit to break the waiting time in two
   */
  app.head(
    '/api/v2/import/geofolia/:numeroBio',
    mergeSchemas(
      protectedWithToken({ cartobio: true, oc: true }),
      operatorFromNumeroBio,
      geofoliaImportSchema
    ),
    async (request, reply) => {
      const { siret } = request.operator
      const { year } = request.query

      const isWellKnown = await service.geofoliaLookup(siret, year)

      return reply.code(isWellKnown === true ? 204 : 404).send()
    }
  )

  /**
   * Retrieves all features associated to a given SIRET linked to a numeroBio
   */
  app.get(
    '/api/v2/import/geofolia/:numeroBio',
    mergeSchemas(
      protectedWithToken({ cartobio: true, oc: true }),
      operatorFromNumeroBio
    ),
    async (request, reply) => {
      const { siret } = request.operator

      const featureCollection = await service.geofoliaParcellaire(siret)

      if (!featureCollection) {
        return reply.code(202).send()
      }

      return reply.send(featureCollection)
    }
  )

  /**
   * Retrieves all features associated to an EVV associated to a numeroBio
   * You still have to add geometries to the collection.
   * Features contains a 'cadastre' property with references to fetch
   */
  app.get(
    '/api/v2/import/evv/:numeroEvv(\\d+)+:numeroBio(\\d+)',
    mergeSchemas(
      protectedWithToken({ cartobio: true, oc: true }),
      operatorFromNumeroBio
    ),
    async (request, reply) => {
      const { numeroEvv } = request.params
      const { siret: expectedSiret } = request.operator

      if (!expectedSiret) {
        throw new InvalidRequestApiError(
          "Le numéro SIRET de l'opérateur n'est pas renseigné sur le portail de Notification de l'Agence Bio. Il est indispensable pour sécuriser la collecte du parcellaire viticole auprès des Douanes."
        )
      }

      return service.evvLookup({ numeroEvv })
        .then(({ siret }) => {
          if (!siret) {
            throw new NotFoundApiError('Ce numéro EVV est introuvable')
          } else if (siret !== expectedSiret) {
            throw new UnauthorizedApiError(
              "les numéros SIRET du nCVI et de l'opérateur Agence Bio ne correspondent pas."
            )
          }
        })
        .then(() => service.evvParcellaire({ numeroEvv }))
        .then((featureCollection) => {
          if (featureCollection.features.length === 0) {
            throw new NotFoundApiError(
              'Ce numéro EVV ne retourne pas de parcelles.'
            )
          }

          return reply.send(featureCollection)
        })
    }
  )

  app.post('/api/v2/certification/parcelles', mergeSchemas(protectedWithToken({ oc: true }), {
    preParsing: async (request, reply, payload) => {
      const stream = payload.pipe(stripBom())

      request.originalPayload = stream
      request.headers['content-length'] = '2'
      return new PassThrough().end('{}')
    }
  }), async (request, reply) => {
    try {
      const stream = request.originalPayload
      const jobId = await service.createImportJob(request.organismeCertificateur.id)

      const { errors, validItems } = await service.collectFullValidationResults(stream, {
        organismeCertificateur: request.organismeCertificateur
      }, jobId)

      const validRecords = validItems.map(v => v.numeroBio)
      const invalidRecords = errors.map(({ numeroBio, error, errorType }) => ({
        ...(numeroBio ? { numeroBio } : {}),
        code: errorType,
        message: error.message
      }))

      if (invalidRecords.length === 0) {
        reply.code(202).send({
          jobId,
          nbObjetRecus: validRecords.length,
          nbObjetAcceptes: validRecords.length,
          nbObjetRefuses: 0,
          listeNumeroBioValides: validRecords
        })
      } else if (validRecords.length > 0) {
        reply.code(207).send({
          jobId,
          nbObjetRecus: validRecords.length + invalidRecords.length,
          nbObjetAcceptes: validRecords.length,
          nbObjetRefuses: invalidRecords.length,
          listeNumeroBioValides: validRecords,
          listeProblemes: invalidRecords
        })
      } else {
        for (const error of errors) {
          await service.addErrorJob(jobId, error)
        }
        await service.updateJobError(validRecords, invalidRecords, invalidRecords.length, [], jobId)
        return reply.code(400).send({
          jobId,
          nbObjetRecus: invalidRecords.length,
          nbObjetAcceptes: 0,
          nbObjetRefuses: invalidRecords.length,
          listeProblemes: invalidRecords
        })
      }

      service.processFullJob(jobId, validItems, errors)
        .catch(err => console.error('service.processFullJob error:', err))

      return reply
    } catch (error) {
      if (error instanceof InvalidRequestApiError) {
        throw error
      }
      throw new InvalidRequestApiError(error.message)
    }
  })

  app.get('/api/v3/import/jobs/:id', mergeSchemas(protectedWithToken({ oc: true })), async (request, reply) => {
    const { id } = request.params
    const result = await service.getCurrentStatusJobs(id)

    if (result.status === 'error') {
      return reply.code(404).send(result)
    } return reply.code(200).send(result)
  })

  app.get('/api/v3/import/parcellaire-imports', mergeSchemas(protectedWithToken({ oc: true })), async (request, reply) => {
    const {
      status,
      from,
      to,
      withPayload = 'false',
      logs = 'none',
      page = 1,
      limit = 20,
      withRejected = 'false'
    } = request.query

    const organismeCertificateur = request.organismeCertificateur.id
    const result = await service.getImportList(
      { status, organismeCertificateur, from, to, withPayload, withRejected, logs, page, limit }
    )

    const links = {}
    const host = request.hostname
    const baseUrl = `https://${host}${request.url.split('?')[0]}`

    const finalPage = parseInt(page)
    const finalLimit = parseInt(limit)

    if (finalLimit > 0) {
      if (finalPage > 1) {
        const prevParams = new URLSearchParams(request.query)
        prevParams.set('page', finalPage - 1)
        prevParams.set('limit', finalLimit)
        links.prev = `${baseUrl}?${prevParams.toString()}`
      } else {
        links.prev = null
      }

      if ((finalPage * finalLimit) < result.meta.total) {
        const nextParams = new URLSearchParams(request.query)
        nextParams.set('page', finalPage + 1)
        nextParams.set('limit', finalLimit)
        links.next = `${baseUrl}?${nextParams.toString()}`
      } else {
        links.next = null
      }
    } else {
      if (finalPage > 1) {
        const prevParams = new URLSearchParams(request.query)
        prevParams.delete('page')
        links.prev = `${baseUrl}?${prevParams.toString()}`
      } else {
        links.prev = null
      }

      links.next = null
    }

    result._links = links

    return reply.send(result)
  })

  app.get('/api/v3/import/parcellaire-imports/:id', mergeSchemas(protectedWithToken({ oc: true })), async (request, reply) => {
    const { id } = request.params
    const { withPayload = 'false', logs = 'none' } = request.query

    const result = await service.getImportById({ id, withPayload, logs })

    if (!result) {
      return reply.status(404).send({ message: 'Import introuvable' })
    }

    return reply.send(result)
  })

  app.get('/api/v3/import/parcellaire-imports/:id/logs', mergeSchemas(protectedWithToken({ oc: true })), async (request, reply) => {
    const { id } = request.params
    const { type = 'all' } = request.query

    const result = await service.getImportLogs({ id, type })

    return reply.send(result)
  })

  app.get('/api/v3/import/parcellaire-imports/:id/payload', mergeSchemas(protectedWithToken({ oc: true })), async (request, reply) => {
    const { id } = request.params

    const result = await service.getImportPayload({ id })

    if (!result) {
      return reply.status(404).send({ message: 'Payload introuvable' })
    }

    return reply.send(result)
  })

  app.get(
    '/api/v2/certification/parcellaires',
    mergeSchemas(protectedWithToken({ oc: true })),
    async (request, reply) => {
      reply.header('Content-Type', 'application/json')
      const { limit, start, anneeAudit, statut, anneeReferenceControle } =
        request.query
      const finalLimit = limit ? Number(limit) : null
      const finalStart = start ? Number(start) : 0

      const records = await service.iterateOperatorLastRecords(
        request.organismeCertificateur.id,
        {
          anneeAudit,
          statut,
          anneeReferenceControle,
          limit: finalLimit,
          start: finalStart
        }
      )

      const apiRecords = await Promise.all(records.map((r) => service.recordToApi(r)))
      const links = {}

      const host = request.hostname
      const baseUrl = `https://${host}${request.url.split('?')[0]}`

      if (finalLimit !== null && finalLimit > 0) {
        if (finalStart > 0) {
          const prevParams = new URLSearchParams(request.query)
          prevParams.set('start', Math.max(0, finalStart - finalLimit))
          prevParams.set('limit', finalLimit)
          links.prev = `${baseUrl}?${prevParams.toString()}`
        } else {
          links.prev = null
        }

        if (records.length === finalLimit) {
          const nextParams = new URLSearchParams(request.query)
          nextParams.set('start', finalStart + finalLimit)
          nextParams.set('limit', finalLimit)
          links.next = `${baseUrl}?${nextParams.toString()}`
        } else {
          links.next = null
        }
      } else {
        if (finalStart > 0) {
          const prevParams = new URLSearchParams(request.query)
          prevParams.delete('start')
          links.prev = `${baseUrl}?${prevParams.toString()}`
        } else {
          links.prev = null
        }

        links.next = null
      }

      return reply.code(200).send({ data: apiRecords, _links: links })
    }
  )

  app.get(
    '/api/v2/certification/parcellaire/:numeroBio',
    mergeSchemas(protectedWithToken({ oc: true }), operatorFromNumeroBio),
    async (request, reply) => {
      const record = await service.getOperatorLastRecord(request.params.numeroBio, {
        anneeAudit: request.query.anneeAudit,
        statut: request.query.statut
      })
      return reply.code(200).send(await service.recordToApi(record))
    }
  )

}
