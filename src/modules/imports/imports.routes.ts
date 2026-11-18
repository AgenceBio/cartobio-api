import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  certificationParcellaireSchema,
  certificationParcellairesSchema,
  certificationParcellesSchema,
  convertAnyGeoSchema,
  convertGeofoliaSchema,
  convertTelepacSchema,
  evvSchema,
  geofoliaLookupSchema,
  geofoliaParcellaireSchema,
  importDetailsSchema,
  importJobSchema,
  importListSchema
} from './imports.schema.js'
import {
  ForbiddenApiError,
  InvalidRequestApiError,
  NotFoundApiError,
  UnauthorizedApiError
} from '../../shared/errors.js'
import { requireOperator, requireOrganismeCertificateur } from '../../shared/request.js'
import { redactAuditNotes } from '../../shared/outputs/record.js'
import { pageUrl } from './imports.utils.js'
import * as service from './imports.service.js'
import { parseTelepacArchive } from './sources/telepac.js'
import { geofoliaLookup, geofoliaParcellaire, parseGeofoliaArchive } from './sources/geofolia.js'
import { evvLookup, evvParcellaire } from './sources/douanes.js'
import { getOperatorLastRecord, iterateOperatorLastRecords } from './sources/certification.js'
import { parseAnyGeographicalArchive } from '../../shared/geo/gdal.js'
import { recordToApi, recordsToApi } from '../../shared/outputs/api.js'
import { isOperatorUser } from '../auth/auth.utils.js'

export default async function importRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  app.post('/api/v2/convert/telepac/geojson', convertTelepacSchema, async (request, reply) => {
    return parseTelepacArchive(request.file()).then((geojson) => reply.send(geojson))
  })

  app.post('/api/v2/convert/geofolia/geojson', convertGeofoliaSchema, async (request, reply) => {
    const data = await request.file()
    if (!data) throw new InvalidRequestApiError('Aucun fichier transmis.')

    return parseGeofoliaArchive(await data.toBuffer()).then((geojson) => reply.send(geojson))
  })

  app.post('/api/v2/convert/anygeo/geojson', convertAnyGeoSchema, async (request, reply) => {
    return parseAnyGeographicalArchive(request.file()).then((geojson) => reply.send(geojson))
  })

  app.head('/api/v2/import/geofolia/:numeroBio', geofoliaLookupSchema, async (request, reply) => {
    const { siret } = requireOperator(request)
    const { year } = request.query

    const isWellKnown = siret ? await geofoliaLookup(siret, year) : false

    return reply.code(isWellKnown ? 204 : 404).send()
  })

  app.get('/api/v2/import/geofolia/:numeroBio', geofoliaParcellaireSchema, async (request, reply) => {
    const { siret } = requireOperator(request)
    if (!siret) {
      throw new InvalidRequestApiError(
        "Le numéro SIRET de l'opérateur n'est pas renseigné sur le portail de Notification de l'Agence Bio."
      )
    }

    const featureCollection = await geofoliaParcellaire(siret)

    if (!featureCollection) {
      return reply.code(202).send()
    }

    return reply.send(featureCollection)
  })

  app.get('/api/v2/import/evv/:numeroEvv(\\d+)+:numeroBio(\\d+)', evvSchema, async (request, reply) => {
    const { numeroEvv } = request.params
    const { siret: expectedSiret } = requireOperator(request)

    if (!expectedSiret) {
      throw new InvalidRequestApiError(
        "Le numéro SIRET de l'opérateur n'est pas renseigné sur le portail de Notification de l'Agence Bio. Il est indispensable pour sécuriser la collecte du parcellaire viticole auprès des Douanes."
      )
    }

    return evvLookup({ numeroEvv })
      .then(({ siret }): void => {
        if (!siret) {
          throw new NotFoundApiError('Ce numéro EVV est introuvable')
        } else if (siret !== expectedSiret) {
          throw new UnauthorizedApiError("les numéros SIRET du nCVI et de l'opérateur Agence Bio ne correspondent pas.")
        }
      })
      .then(() => evvParcellaire({ numeroEvv }))
      .then((featureCollection) => {
        if (featureCollection.features.length === 0) {
          throw new NotFoundApiError('Ce numéro EVV ne retourne pas de parcelles.')
        }

        return reply.send(featureCollection)
      })
  })

  app.post('/api/v2/certification/parcelles', certificationParcellesSchema, async (request, reply) => {
    const organismeCertificateur = requireOrganismeCertificateur(request)
    const jobId = await service.createImportJob(organismeCertificateur.id)

    const { errors, validItem } = await service
      .collectValidationResult(request.body, { organismeCertificateur }, jobId)
      .catch(async (error: unknown) => {
        await service.failImportJob(jobId, error)
        throw error
      })

    if (!validItem) {
      const listeProblemes = errors.map(({ numeroBio, message, code, idParcelle, nomParcelle }) => ({
        ...(numeroBio ? { numeroBio } : {}),
        code,
        message,
        ...(idParcelle && nomParcelle ? { idParcelle, nomParcelle } : {})
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

    service
      .processFullJob(jobId, validItem)
      .catch((err): void => request.log.error({ err }, "Traitement du job d'import en échec"))

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
    }
    return reply.code(200).send(result)
  })

  app.get('/api/v3/import/parcellaire-imports', importListSchema, async (request, reply) => {
    const { status, from, to, withPayload, page: finalPage, limit: finalLimit, withRejected } = request.query

    const organismeCertificateur = requireOrganismeCertificateur(request).id
    const result = await service.getImportList({
      status,
      organismeCertificateur,
      from,
      to,
      payload: withPayload,
      withRejected,
      page: finalPage,
      limit: finalLimit
    })

    const links =
      finalLimit > 0
        ? {
            prev: finalPage > 1 ? pageUrl(request.url, { page: finalPage - 1, limit: finalLimit }) : null,
            next:
              finalPage * finalLimit < result.meta.total
                ? pageUrl(request.url, { page: finalPage + 1, limit: finalLimit })
                : null
          }
        : { prev: finalPage > 1 ? pageUrl(request.url, { page: null }) : null, next: null }

    return reply.send({ ...result, _links: links })
  })

  app.get('/api/v3/import/parcellaire-imports/:id', importDetailsSchema, async (request, reply) => {
    const { id } = request.params
    const { withPayload } = request.query

    const result = await service.getImportById({
      id,
      payload: withPayload,
      organismeCertificateur: requireOrganismeCertificateur(request).id
    })

    if (!result) throw new NotFoundApiError('Import introuvable')

    return reply.send(result)
  })

  app.get('/api/v2/certification/parcellaires', certificationParcellairesSchema, async (request, reply) => {
    reply.header('Content-Type', 'application/json')
    const { limit: finalLimit, start: finalStart, anneeAudit, statut, anneeReferenceControle } = request.query

    const records = await iterateOperatorLastRecords(requireOrganismeCertificateur(request).id, {
      anneeAudit,
      statut,
      anneeReferenceControle,
      limit: finalLimit,
      start: finalStart
    })

    const apiRecords = await recordsToApi(records)
    request.log.info(
      {
        audit: 'export-api',
        ocId: requireOrganismeCertificateur(request).id,
        count: apiRecords.length
      },
      "Lecture des parcellaires par l'API OC"
    )
    const links = {
      prev:
        finalStart > 0
          ? pageUrl(request.url, {
              start: Math.max(0, finalStart - finalLimit),
              limit: finalLimit
            })
          : null,
      next:
        records.length === finalLimit
          ? pageUrl(request.url, { start: finalStart + finalLimit, limit: finalLimit })
          : null
    }

    return reply.code(200).send({ data: apiRecords, _links: links })
  })

  app.get('/api/v2/certification/parcellaire/:numeroBio', certificationParcellaireSchema, async (request, reply) => {
    if (isOperatorUser(request.user)) {
      throw new ForbiddenApiError('Accès réservé aux organismes certificateurs et aux administrateurs.')
    }
    const ocId = (request.organismeCertificateur ?? request.user?.organismeCertificateur)?.id
    const record = await getOperatorLastRecord(request.params.numeroBio, {
      anneeAudit: request.query.anneeAudit,
      statut: request.query.statut
    })
    if (ocId !== undefined && record.oc_id !== ocId) {
      if (requireOperator(request).organismeCertificateur.id !== ocId)
        throw new UnauthorizedApiError("vous n'êtes pas autorisé·e à accéder à ce contenu avec vos identifiants.")
      redactAuditNotes(record)
    }
    request.log.info(
      { audit: 'export-api', ocId, userId: request.user?.id, recordId: record.record_id },
      "Lecture d'un parcellaire par l'API OC"
    )
    return reply.code(200).send(await recordToApi(record))
  })
}
