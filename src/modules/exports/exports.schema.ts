import {
  exportParcellaireBodySchema,
  exportParcellaireResponseSchema,
  exportPdfParamsSchema,
  exportPdfQuerySchema,
  exportPdfResponseSchema
} from '@agencebio/cartobio-types'
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
import { enforceOperatorAccess } from '../../shared/middlewares.js'

export const exportPdfSchema = withSchema(
  mergeSchemas(protectedWithToken(), operatorFromRecordId, {
    preHandler: [enforceOperatorAccess()]
  }),
  {
    operationId: 'exportAttestationProduction',
    tags: [TAGS.EXPORTS],
    summary: 'Attestation de production en PDF',
    description:
      'Réutilise la dernière attestation valide, sinon la génère. Les parcellaires de plus de 80 parcelles ne sont pas générés à la volée.',
    params: exportPdfParamsSchema,
    querystring: exportPdfQuerySchema,
    response: {
      ...commonErrorResponses,
      200: exportPdfResponseSchema,
      204: describedResponse(
        "Génération en tâche de fond (plus de 80 parcelles ou file d'attente pleine), à récupérer plus tard"
      ),
      400: apiError('Génération impossible : parcelle sans culture ou sans nom, ou parcellaire vide'),
      404: apiError('Parcellaire ou opérateur introuvable')
    }
  }
)

export const exportParcellaireSchema = withSchema(protectedWithToken({ oc: true, cartobio: true }), {
  operationId: 'exportOcParcellaires',
  tags: [TAGS.EXPORTS],
  summary: "Exporter les parcellaires des opérateurs de l'OC",
  description:
    "Une ligne par parcellaire (surfaces par niveau de conversion, dates d'audit et de certification…), pour les opérateurs correspondant à la recherche et aux filtres.",
  body: exportParcellaireBodySchema,
  response: {
    ...commonErrorResponses,
    200: exportParcellaireResponseSchema.meta({ description: 'Une ligne par parcellaire' })
  }
})
