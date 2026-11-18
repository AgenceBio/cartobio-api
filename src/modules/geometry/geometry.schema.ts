import type { FastifyRequest } from 'fastify'
import {
  addGeometryBodySchema,
  addGeometryResponseSchema,
  borderCutBodySchema,
  borderCutResponseSchema,
  geometryEqualsBodySchema,
  geometryEqualsResponseSchema,
  recordIdParamsSchema
} from '@agencebio/cartobio-types'
import type { GeometryEqualsBody } from '@agencebio/cartobio-types'
import {
  apiError,
  commonErrorResponses,
  describedResponse,
  mergeSchemas,
  operatorFromRecordId,
  protectedWithToken,
  TAGS,
  withSchema
} from '../../shared/routes.js'
import { enforceOperatorAccess, loadRecordAndOperator } from '../../shared/middlewares.js'
import { getRecord } from '../../shared/parcellaires/parcellaires.service.js'

export const borderCutSchema = withSchema(protectedWithToken(), {
  operationId: 'cutParcelleBorder',
  tags: [TAGS.GEOMETRIE],
  summary: "Découper la bordure d'une parcelle",
  description: 'Calcule avec PostGIS une bordure de largeur donnée, sur tout le contour ou entre deux points.',
  body: borderCutBodySchema,
  response: {
    ...commonErrorResponses,
    200: borderCutResponseSchema.meta({ description: 'Parcelle sans bordure et bordure' }),
    400: describedResponse('Découpe impossible (corps vide)')
  }
})

export const geometryEqualsSchema = withSchema(
  mergeSchemas(protectedWithToken(), {
    preHandler: [
      async (request: FastifyRequest): Promise<void> =>
        loadRecordAndOperator(request, (request.body as GeometryEqualsBody).payload.old, getRecord),
      enforceOperatorAccess()
    ]
  }),
  {
    operationId: 'compareParcellaires',
    tags: [TAGS.GEOMETRIE],
    summary: 'Comparer les géométries de deux parcellaires',
    description:
      'Identifie les parcelles ajoutées, supprimées ou modifiées entre le parcellaire le plus ancien et le plus récent.',
    body: geometryEqualsBodySchema,
    response: {
      ...commonErrorResponses,
      200: geometryEqualsResponseSchema.meta({
        description: 'Résultat de la comparaison et différences en GeoJSON'
      }),
      404: apiError('Parcellaire ou opérateur introuvable')
    }
  }
)

export const addGeometrySchema = withSchema(
  mergeSchemas(protectedWithToken(), operatorFromRecordId, {
    preHandler: [enforceOperatorAccess()]
  }),
  {
    operationId: 'checkParcelleGeometry',
    tags: [TAGS.GEOMETRIE],
    summary: "Vérifier la géométrie d'une parcelle",
    description:
      'Détecte les chevauchements et inclusions avec les autres parcelles du parcellaire, et propose des corrections en cas de chevauchement.',
    params: recordIdParamsSchema,
    body: addGeometryBodySchema,
    response: {
      ...commonErrorResponses,
      200: addGeometryResponseSchema.meta({
        description: 'Validité de la géométrie et corrections proposées'
      }),
      404: apiError('Parcellaire ou opérateur introuvable')
    }
  }
)
