import {
  attestationProductionQuerySchema,
  attestationProductionResponseSchema,
  featureControlResponseSchema,
  normalizedRecordSchema,
  recordFeatureCollectionSchema,
  auditParamsSchema,
  controleeParamsSchema,
  featureParamsSchema,
  createFeatureBodySchema,
  createFeaturesFromOtherBodySchema,
  createRecordBodySchema,
  deleteFeatureBodySchema,
  featureCollectionSchema,
  featureSchema,
  numeroBioParamsSchema,
  recordInfosBodySchema
} from '@agencebio/cartobio-types'
import { apiError, checkCertificationStatus, commonErrorResponses, describedResponse, mergeSchemas, operatorFromNumeroBio, operatorFromRecordId, protectedWithToken, TAGS, withSchema } from '../../shared/routes.js'
import type { CartobioExtendedRouteShorthandOptions, WithSchema } from '../../shared/routes.js'
import { enforceOperatorAccess, haveRightToUpdate } from '../../shared/middlewares.js'

const operatorAccess = { preHandler: [enforceOperatorAccess()] }

const recordRoute = (): WithSchema<CartobioExtendedRouteShorthandOptions, { params: typeof auditParamsSchema }> => withSchema(mergeSchemas(protectedWithToken(), operatorFromRecordId, operatorAccess), { params: auditParamsSchema })

const recordErrorResponses = {
  ...commonErrorResponses,
  404: apiError('Parcellaire ou opérateur introuvable'),
  412: apiError('Le parcellaire a été modifié depuis la date `If-Unmodified-Since`')
}

const recordResponse = { ...recordErrorResponses, 200: normalizedRecordSchema.meta({ description: 'Parcellaire mis à jour, avec ses parcelles' }) }

export const getRecordSchema = withSchema(recordRoute(), {
  operationId: 'getRecord',
  tags: [TAGS.PARCELLAIRES],
  summary: 'Détail d\'un parcellaire',
  response: { ...recordErrorResponses, 200: normalizedRecordSchema.meta({ description: 'Parcellaire, avec ses parcelles' }) }
})

export const attestationProductionSchema = withSchema(recordRoute(), {
  operationId: 'hasAttestationProduction',
  tags: [TAGS.PARCELLAIRES],
  summary: 'Présence d\'une attestation de production valide',
  querystring: attestationProductionQuerySchema,
  response: { ...recordErrorResponses, 200: attestationProductionResponseSchema.meta({ description: 'Présence d\'une attestation de production' }) }
})

export const markControlledSchema = withSchema(recordRoute(), {
  operationId: 'markParcelleControlled',
  tags: [TAGS.PARCELLES],
  summary: 'Marquer une parcelle comme contrôlée',
  params: controleeParamsSchema,
  response: { ...recordErrorResponses, 200: featureControlResponseSchema.meta({ description: 'Parcelle marquée comme contrôlée' }) }
})

export const markUncontrolledSchema = withSchema(recordRoute(), {
  operationId: 'markParcelleUncontrolled',
  tags: [TAGS.PARCELLES],
  summary: 'Marquer une parcelle comme non contrôlée',
  params: controleeParamsSchema,
  response: { ...recordErrorResponses, 200: featureControlResponseSchema.meta({ description: 'Parcelle marquée comme non contrôlée' }) }
})

export const getFeaturesSchema = withSchema(recordRoute(), {
  operationId: 'getRecordParcelles',
  tags: [TAGS.PARCELLES],
  summary: 'Parcelles d\'un parcellaire',
  response: { ...recordErrorResponses, 200: recordFeatureCollectionSchema.meta({ description: 'FeatureCollection GeoJSON des parcelles' }) }
})

export const createRecordSchema = withSchema(
  mergeSchemas(operatorFromNumeroBio, checkCertificationStatus, protectedWithToken(), { preValidation: [haveRightToUpdate()] }),
  {
    operationId: 'createRecord',
    tags: [TAGS.PARCELLAIRES],
    summary: 'Créer un parcellaire pour un opérateur',
    description: 'Un parcellaire existant de même date d\'audit peut être mis à jour plutôt que recréé (fusion décrite dans la RFC 001-api-parcellaire). Avec `importPrevious`, recopie les données des parcelles du parcellaire `recordId`.',
    params: numeroBioParamsSchema,
    body: createRecordBodySchema,
    response: {
      ...commonErrorResponses,
      200: normalizedRecordSchema.meta({ description: 'Parcellaire créé, avec ses parcelles' }),
      400: apiError('Données invalides (géométrie, dates de certification…)'),
      404: apiError('Opérateur introuvable')
    }
  }
)

export const deleteRecordSchema = withSchema(recordRoute(), {
  operationId: 'deleteRecord',
  tags: [TAGS.PARCELLAIRES],
  summary: 'Supprimer un parcellaire',
  description: 'Suppression logique : le parcellaire est conservé en base, marqué comme supprimé.',
  params: auditParamsSchema,
  response: { ...recordErrorResponses, 204: describedResponse('Parcellaire supprimé') }
})

export const patchRecordSchema = withSchema(recordRoute(), {
  operationId: 'patchRecord',
  tags: [TAGS.PARCELLAIRES],
  summary: 'Modifier les informations d\'un parcellaire',
  description: 'Mise à jour partielle des informations d\'audit et de certification (hors parcelles). Un changement de `certification_state` est historisé ; le passage à `CERTIFIED` notifie l\'opérateur par email.',
  params: auditParamsSchema,
  body: recordInfosBodySchema,
  response: recordResponse
})

export const createFeatureSchema = withSchema(recordRoute(), {
  operationId: 'createParcelle',
  tags: [TAGS.PARCELLES],
  summary: 'Ajouter une parcelle',
  body: createFeatureBodySchema,
  response: recordResponse
})

export const patchFeatureCollectionSchema = withSchema(recordRoute(), {
  operationId: 'patchParcelles',
  tags: [TAGS.PARCELLES],
  summary: 'Modifier plusieurs parcelles',
  description: 'Action de masse : les parcelles transmises sont mises à jour, les autres sont ignorées.',
  body: featureCollectionSchema,
  response: recordResponse
})

export const updateFeaturePropertiesSchema = withSchema(recordRoute(), {
  operationId: 'patchParcelle',
  tags: [TAGS.PARCELLES],
  summary: 'Modifier une parcelle',
  description: 'Les propriétés absentes sont conservées, les autres sont ajoutées ou remplacées (`cultures` compris).',
  params: featureParamsSchema,
  body: featureSchema,
  response: recordResponse
})

export const deleteSingleFeatureSchema = withSchema(recordRoute(), {
  operationId: 'deleteParcelle',
  tags: [TAGS.PARCELLES],
  summary: 'Supprimer une parcelle',
  params: featureParamsSchema,
  body: deleteFeatureBodySchema,
  response: recordResponse
})

export const createFeaturesFromOtherSchema = withSchema(recordRoute(), {
  operationId: 'replaceParcelles',
  tags: [TAGS.PARCELLES],
  summary: 'Remplacer des parcelles par de nouvelles',
  description: 'Les parcelles `from` sont supprimées et les nouvelles parcelles les référencent comme origine (découpage, fusion…).',
  body: createFeaturesFromOtherBodySchema,
  response: recordResponse
})
