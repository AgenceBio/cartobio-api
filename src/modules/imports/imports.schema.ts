import {
  certificationParcellaireQuerySchema,
  certificationParcellairesResponseSchema,
  importJobNotFoundResponseSchema,
  importJobStatusResponseSchema,
  importListResponseSchema,
  importReportSchema,
  importSummarySchema,
  inputApiRecordBodySchema,
  outputApiRecordSchema,
  apiErrorSchema,
  certificationParcellairesQuerySchema,
  evvParamsSchema,
  geofoliaQuerySchema,
  importDetailsQuerySchema,
  importedFeatureCollectionSchema,
  importIdParamsSchema,
  importListQuerySchema,
  numeroBioParamsSchema
} from '@agencebio/cartobio-types'
import { z } from 'zod'
import type { FastifySchema, FastifySchemaCompiler } from 'fastify'
import {
  apiError,
  commonErrorResponses,
  describedResponse,
  mergeSchemas,
  protectedWithToken,
  operatorFromNumeroBio,
  TAGS,
  withSchema
} from '../../shared/routes.js'
import type { CartobioExtendedRouteShorthandOptions, ProtectedRoute } from '../../shared/routes.js'
import { enforceOperatorAccess } from '../../shared/middlewares.js'

const ocOrCartobio = (): ProtectedRoute => protectedWithToken({ cartobio: true, oc: true })
const operatorRoute = (): CartobioExtendedRouteShorthandOptions =>
  mergeSchemas(ocOrCartobio(), operatorFromNumeroBio, { preHandler: [enforceOperatorAccess()] })

const featureCollectionResponse = {
  ...commonErrorResponses,
  200: importedFeatureCollectionSchema.meta({
    description: 'FeatureCollection GeoJSON à prévisualiser avant import'
  }),
  400: apiError('Fichier absent, illisible ou invalide')
}

export const convertTelepacSchema = withSchema(protectedWithToken({ cartobio: true, oc: true, exchange: true }), {
  operationId: 'convertTelepac',
  tags: [TAGS.IMPORT],
  summary: 'Convertir un export Telepac en GeoJSON',
  description: 'Fichier XML ou Shapefile zippé envoyé en multipart.',
  response: featureCollectionResponse
})

export const convertGeofoliaSchema = withSchema(protectedWithToken({ exchange: true }), {
  operationId: 'convertGeofolia',
  tags: [TAGS.IMPORT],
  summary: 'Convertir un export Geofolia en GeoJSON',
  description: 'Fichier envoyé en multipart.',
  response: featureCollectionResponse
})

export const convertAnyGeoSchema = withSchema(protectedWithToken({ exchange: true }), {
  operationId: 'convertGeographicalFile',
  tags: [TAGS.IMPORT],
  summary: 'Convertir un fichier géographique en GeoJSON',
  description: 'Tout format lu par GDAL (GeoJSON, KML, GPKG, Shapefile zippé…), envoyé en multipart.',
  response: featureCollectionResponse
})

export const geofoliaLookupSchema = withSchema(
  { ...operatorRoute(), config: { swagger: { exposeHeadRoute: true } } },
  {
    operationId: 'requestGeofoliaParcellaire',
    tags: [TAGS.IMPORT],
    summary: "Demander le parcellaire Geofolia d'un opérateur",
    description:
      "Déclenche la commande des données auprès de Geofolia (via le SIRET de l'opérateur), à récupérer ensuite avec le GET.",
    params: numeroBioParamsSchema,
    querystring: geofoliaQuerySchema,
    response: {
      204: describedResponse('Opérateur connu de Geofolia, commande lancée'),
      404: describedResponse('Opérateur inconnu de Geofolia (corps vide)')
    }
  }
)

export const geofoliaParcellaireSchema = withSchema(operatorRoute(), {
  operationId: 'getGeofoliaParcellaire',
  tags: [TAGS.IMPORT],
  summary: "Récupérer le parcellaire Geofolia d'un opérateur",
  params: numeroBioParamsSchema,
  response: {
    ...featureCollectionResponse,
    202: describedResponse('Commande Geofolia pas encore prête, réessayer plus tard')
  }
})

export const evvSchema = withSchema(operatorRoute(), {
  operationId: 'getEvvParcellaire',
  tags: [TAGS.IMPORT],
  summary: "Parcellaire viticole d'un numéro EVV",
  description:
    "Interroge le nCVI des Douanes après vérification que le SIRET de l'EVV est celui de l'opérateur. Les parcelles n'ont pas de géométrie : la propriété `cadastre` donne les références à récupérer.",
  params: evvParamsSchema,
  response: {
    ...featureCollectionResponse,
    404: apiError('Numéro EVV introuvable, ou sans parcelle')
  }
})

export const certificationParcellesSchema = {
  ...withSchema(protectedWithToken({ oc: true }), {
    operationId: 'importParcellaires',
    tags: [TAGS.API_PARCELLAIRE],
    summary: 'Envoyer un parcellaire',
    description:
      "Valide le parcellaire reçu puis l'enregistre de façon asynchrone. Suivre l'avancement avec `GET /api/v3/import/jobs/{id}`.",
    body: inputApiRecordBodySchema,
    response: {
      ...commonErrorResponses,
      202: importReportSchema.meta({
        description: 'Le parcellaire est accepté, enregistrement en cours'
      }),
      400: z.union([importReportSchema, apiErrorSchema]).meta({
        description: "Le parcellaire est refusé (bilan de l'envoi), ou corps illisible (erreur)"
      })
    }
  }),
  validatorCompiler: (() => (data) => ({
    value: data
  })) satisfies FastifySchemaCompiler<FastifySchema>,
  bodyLimit: 50 * 1024 * 1024
}

export const importJobSchema = withSchema(protectedWithToken({ oc: true }), {
  operationId: 'getImportJob',
  tags: [TAGS.API_PARCELLAIRE],
  summary: "État d'un envoi de parcellaires",
  params: importIdParamsSchema,
  response: {
    ...commonErrorResponses,
    200: importJobStatusResponseSchema.meta({
      description: 'Statut du job, et son résultat une fois terminé'
    }),
    404: importJobNotFoundResponseSchema.meta({ description: 'Job introuvable pour cet OC' })
  }
})

export const importListSchema = withSchema(protectedWithToken({ oc: true }), {
  operationId: 'listImports',
  tags: [TAGS.API_PARCELLAIRE],
  summary: 'Historique des envois de parcellaires',
  description: "Envois de l'OC, du plus récent au plus ancien, avec liens de pagination (`_links`).",
  querystring: importListQuerySchema,
  response: {
    ...commonErrorResponses,
    200: importListResponseSchema.meta({ description: 'Envois, total et liens de pagination' })
  }
})

export const importDetailsSchema = withSchema(protectedWithToken({ oc: true }), {
  operationId: 'getImport',
  tags: [TAGS.API_PARCELLAIRE],
  summary: "Détail d'un envoi de parcellaires",
  params: importIdParamsSchema,
  querystring: importDetailsQuerySchema,
  response: {
    ...commonErrorResponses,
    200: importSummarySchema.meta({ description: 'Envoi et son résultat' }),
    404: apiError('Import introuvable pour cet OC')
  }
})
export const certificationParcellairesSchema = withSchema(protectedWithToken({ oc: true }), {
  operationId: 'listOcParcellaires',
  tags: [TAGS.API_PARCELLAIRE],
  summary: "Derniers parcellaires des opérateurs de l'OC",
  description:
    "Le dernier parcellaire de chaque opérateur, au format de l'API parcellaire, avec liens de pagination (`_links`).",
  querystring: certificationParcellairesQuerySchema,
  response: {
    ...commonErrorResponses,
    200: certificationParcellairesResponseSchema.meta({
      description: 'Parcellaires et liens de pagination'
    })
  }
})

export const certificationParcellaireSchema = withSchema(
  mergeSchemas(protectedWithToken({ oc: true }), operatorFromNumeroBio),
  {
    operationId: 'getOperatorLastParcellaire',
    tags: [TAGS.API_PARCELLAIRE],
    summary: "Dernier parcellaire d'un opérateur",
    params: numeroBioParamsSchema,
    querystring: certificationParcellaireQuerySchema,
    response: {
      ...commonErrorResponses,
      200: outputApiRecordSchema.meta({
        description: "Parcellaire au format de l'API parcellaire"
      }),
      403: apiError('Route réservée aux organismes certificateurs et aux administrateurs'),
      404: apiError('Opérateur ou parcellaire introuvable')
    }
  }
)
