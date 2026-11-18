import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  certificationParcellaireSchema, certificationParcellairesSchema, certificationParcellesSchema, convertAnyGeoSchema, convertGeofoliaSchema,
  convertTelepacSchema, evvSchema, geofoliaLookupSchema, geofoliaParcellaireSchema, importDetailsSchema, importJobSchema, importListSchema
} from './imports.schema.js'
import { InvalidRequestApiError, NotFoundApiError, UnauthorizedApiError } from '../../shared/errors.js'
import { requireOperator, requireOrganismeCertificateur } from '../../shared/request.js'
import * as service from './imports.service.js'

export default async function importRoutes (fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  app.post(
    '/api/v2/convert/telepac/geojson',
    convertTelepacSchema,
    async (request, reply) => {
      return service.parseTelepacArchive(request.file()).then((geojson) =>
        reply.send(geojson)
      )
    }
  )

  app.post(
    '/api/v2/convert/geofolia/geojson',
    convertGeofoliaSchema,
    async (request, reply) => {
      const data = await request.file()
      if (!data) throw new InvalidRequestApiError('Aucun fichier transmis.')

      return service.parseGeofoliaArchive(await data.toBuffer()).then((geojson) =>
        reply.send(geojson)
      )
    }
  )

  app.post(
    '/api/v2/convert/anygeo/geojson',
    convertAnyGeoSchema,
    async (request, reply) => {
      return service.parseAnyGeographicalArchive(request.file()).then((geojson) =>
        reply.send(geojson)
      )
    }
  )

  app.head(
    '/api/v2/import/geofolia/:numeroBio',
    geofoliaLookupSchema,
    async (request, reply) => {
      const { siret } = requireOperator(request)
      const { year } = request.query

      const isWellKnown = await service.geofoliaLookup(siret, year)

      return reply.code(isWellKnown === true ? 204 : 404).send()
    }
  )

  app.get(
    '/api/v2/import/geofolia/:numeroBio',
    geofoliaParcellaireSchema,
    async (request, reply) => {
      const { siret } = requireOperator(request)

      const featureCollection = await service.geofoliaParcellaire(siret)

      if (!featureCollection) {
        return reply.code(202).send()
      }

      return reply.send(featureCollection)
    }
  )

  app.get(
    '/api/v2/import/evv/:numeroEvv(\\d+)+:numeroBio(\\d+)',
    evvSchema,
    async (request, reply) => {
      const { numeroEvv } = request.params
      const { siret: expectedSiret } = requireOperator(request)

      if (!expectedSiret) {
        throw new InvalidRequestApiError(
          "Le numéro SIRET de l'opérateur n'est pas renseigné sur le portail de Notification de l'Agence Bio. Il est indispensable pour sécuriser la collecte du parcellaire viticole auprès des Douanes."
        )
      }

      return service.evvLookup({ numeroEvv })
        .then(({ siret }): void => {
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

  app.post('/api/v2/certification/parcelles', certificationParcellesSchema, async (request, reply) => {
    const organismeCertificateur = requireOrganismeCertificateur(request)
    const jobId = await service.createImportJob(organismeCertificateur.id)

    const { errors, validItem } = await service.collectValidationResult(request.body, { organismeCertificateur }, jobId)

    if (!validItem) {
      const listeProblemes = errors.map(({ numeroBio, message, code, idParcelle, nomParcelle }) => ({
        ...(numeroBio ? { numeroBio } : {}),
        code,
        message,
        ...(idParcelle && nomParcelle
          ? { idParcelle, nomParcelle }
          : {})
      }))

      for (const error of errors) {
        await service.addErrorJob(jobId, error)
      }

      await service.updateJobError([], listeProblemes, 1, [], jobId)
      return reply.code(400).send({
        jobId,
        nbObjetRecus: 1,
        nbObjetAcceptes: 0,
        nbObjetRefuses: 1,
        listeProblemes
      })
    }

    service.processFullJob(jobId, validItem)
      .catch((err): void => request.log.error({ err }, 'service.processFullJob error'))

    return reply.code(202).send({
      jobId,
      nbObjetRecus: 1,
      nbObjetAcceptes: 1,
      nbObjetRefuses: 0,
      listeNumeroBioValides: [validItem.numeroBio]
    })
  })

  app.get('/api/v3/import/jobs/:id', importJobSchema, async (request, reply) => {
    const { id } = request.params
    const result = await service.getCurrentStatusJobs(id, requireOrganismeCertificateur(request).id)

    if (result.status === 'error') {
      return reply.code(404).send(result)
    } return reply.code(200).send(result)
  })

  app.get('/api/v3/import/parcellaire-imports', importListSchema, async (request, reply) => {
    const {
      status,
      from,
      to,
      withPayload = 'false',
      page = '1',
      limit = '20',
      withRejected = 'false'
    } = request.query

    const finalPage = parseInt(page)
    const finalLimit = parseInt(limit)

    const organismeCertificateur = requireOrganismeCertificateur(request).id
    const result = await service.getImportList(
      { status, organismeCertificateur, from, to, payload: withPayload, withRejected, page: finalPage, limit: finalLimit }
    )

    const links: { prev?: string | null; next?: string | null } = {}
    const host = request.hostname
    const baseUrl = `https://${host}${request.url.split('?')[0]}`

    if (finalLimit > 0) {
      if (finalPage > 1) {
        const prevParams = new URLSearchParams(request.query as Record<string, string>)
        prevParams.set('page', String(finalPage - 1))
        prevParams.set('limit', String(finalLimit))
        links.prev = `${baseUrl}?${prevParams.toString()}`
      } else {
        links.prev = null
      }

      if ((finalPage * finalLimit) < result.meta.total) {
        const nextParams = new URLSearchParams(request.query as Record<string, string>)
        nextParams.set('page', String(finalPage + 1))
        nextParams.set('limit', String(finalLimit))
        links.next = `${baseUrl}?${nextParams.toString()}`
      } else {
        links.next = null
      }
    } else {
      if (finalPage > 1) {
        const prevParams = new URLSearchParams(request.query as Record<string, string>)
        prevParams.delete('page')
        links.prev = `${baseUrl}?${prevParams.toString()}`
      } else {
        links.prev = null
      }

      links.next = null
    }

    return reply.send({ ...result, _links: links })
  })

  app.get('/api/v3/import/parcellaire-imports/:id', importDetailsSchema, async (request, reply) => {
    const { id } = request.params
    const { withPayload = 'false' } = request.query

    const result = await service.getImportById({ id, payload: withPayload, organismeCertificateur: requireOrganismeCertificateur(request).id })

    if (!result) {
      return reply.status(404).send({ message: 'Import introuvable' })
    }

    return reply.send(result)
  })

  // Décommenter si les utilisateurs en font la demande
  // app.get('/api/v3/import/parcellaire-imports/:id/logs', importLogsSchema, async (request, reply) => {
  //   const { id } = request.params
  //   const { type = 'all' } = request.query

  //   const result = await service.getImportLogs({ id, type })

  //   return reply.send(result)
  // })

  // app.get('/api/v3/import/parcellaire-imports/:id/payload', importPayloadSchema, async (request, reply) => {
  //   const { id } = request.params

  //   const result = await service.getImportPayload({ id })

  //   if (!result) {
  //     return reply.status(404).send({ message: 'Payload introuvable' })
  //   }

  //   return reply.send(result)
  // })

  app.get(
    '/api/v2/certification/parcellaires',
    certificationParcellairesSchema,
    async (request, reply) => {
      reply.header('Content-Type', 'application/json')
      const { limit, start, anneeAudit, statut, anneeReferenceControle } =
        request.query
      const finalLimit = limit ? Number(limit) : null
      const finalStart = start ? Number(start) : 0

      const records = await service.iterateOperatorLastRecords(
        requireOrganismeCertificateur(request).id,
        {
          anneeAudit,
          statut,
          anneeReferenceControle,
          limit: finalLimit,
          start: finalStart
        }
      )

      const apiRecords = await Promise.all(records.map((r) => service.recordToApi(r)))
      const links: { prev?: string | null; next?: string | null } = {}

      const host = request.hostname
      const baseUrl = `https://${host}${request.url.split('?')[0]}`

      if (finalLimit !== null && finalLimit > 0) {
        if (finalStart > 0) {
          const prevParams = new URLSearchParams(request.query as Record<string, string>)
          prevParams.set('start', String(Math.max(0, finalStart - finalLimit)))
          prevParams.set('limit', String(finalLimit))
          links.prev = `${baseUrl}?${prevParams.toString()}`
        } else {
          links.prev = null
        }

        if (records.length === finalLimit) {
          const nextParams = new URLSearchParams(request.query as Record<string, string>)
          nextParams.set('start', String(finalStart + finalLimit))
          nextParams.set('limit', String(finalLimit))
          links.next = `${baseUrl}?${nextParams.toString()}`
        } else {
          links.next = null
        }
      } else {
        if (finalStart > 0) {
          const prevParams = new URLSearchParams(request.query as Record<string, string>)
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
    certificationParcellaireSchema,
    async (request, reply) => {
      const record = await service.getOperatorLastRecord(request.params.numeroBio, {
        anneeAudit: request.query.anneeAudit,
        statut: request.query.statut
      })
      return reply.code(200).send(await service.recordToApi(record))
    }
  )

}
