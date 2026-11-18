import {
  autocompleteQuerySchema,
  certificationSearchBodySchema,
  dashboardSummaryBodySchema,
  dashboardSummaryResponseSchema,
  numeroBioParamsSchema,
  numeroBioStringParamsSchema,
  operatorAutocompleteResponseSchema,
  operatorImportPacResponseSchema,
  operatorRecordsResponseSchema,
  operatorSearchResponseSchema,
  operatorsDashboardResponseSchema,
  pinnedOperatorSchema,
  pinResponseSchema,
  userOperatorsQuerySchema,
  userOperatorsResponseSchema
} from '@agencebio/cartobio-types'
import { apiError, commonErrorResponses, describedResponse, mergeSchemas, protectedWithToken, operatorFromNumeroBio, TAGS, withSchema } from '../../shared/routes.js'
import { enforceOperatorAccess } from '../../shared/middlewares.js'

const operatorErrorResponses = {
  ...commonErrorResponses,
  403: apiError('L\'opérateur n\'est pas rattaché à l\'utilisateur'),
  404: apiError('Opérateur introuvable')
}

export const certificationSearchSchema = withSchema(protectedWithToken(), {
  operationId: 'searchOperators',
  tags: [TAGS.OPERATEURS],
  summary: 'Rechercher les opérateurs de l\'OC',
  description: 'Opérateurs de l\'organisme certificateur de l\'utilisateur, enrichis de leurs parcellaires CartoBio, filtrés et paginés.',
  body: certificationSearchBodySchema,
  response: { ...commonErrorResponses, 200: operatorSearchResponseSchema.meta({ description: 'Page d\'opérateurs et pagination' }) }
})

export const certificationAdminSearchSchema = withSchema(protectedWithToken({ admin: true }), {
  operationId: 'adminSearchOperators',
  tags: [TAGS.OPERATEURS],
  summary: 'Rechercher parmi tous les opérateurs (admin)',
  body: certificationSearchBodySchema,
  response: { ...commonErrorResponses, 200: operatorSearchResponseSchema.meta({ description: 'Page d\'opérateurs et pagination' }) }
})

export const autocompleteSchema = withSchema(protectedWithToken(), {
  operationId: 'autocompleteOperators',
  tags: [TAGS.OPERATEURS],
  summary: 'Autocomplétion d\'opérateurs',
  description: 'Opérateurs de l\'OC de l\'utilisateur, ou à défaut ceux rattachés à l\'utilisateur.',
  querystring: autocompleteQuerySchema,
  response: { ...commonErrorResponses, 200: operatorAutocompleteResponseSchema.meta({ description: 'Opérateurs correspondant à la recherche' }) }
})

export const userOperatorsSchema = withSchema(protectedWithToken({ cartobio: true }), {
  operationId: 'listUserOperators',
  tags: [TAGS.OPERATEURS],
  summary: 'Opérateurs rattachés à l\'utilisateur',
  description: 'Triés par date de notification décroissante, avec leur état d\'épinglage.',
  querystring: userOperatorsQuerySchema,
  response: { ...commonErrorResponses, 200: userOperatorsResponseSchema.meta({ description: 'Nombre total et page d\'opérateurs' }) }
})

export const dashboardSchema = withSchema(protectedWithToken({ oc: true, cartobio: true }), {
  operationId: 'getOperatorsDashboard',
  tags: [TAGS.TABLEAU_DE_BORD],
  summary: 'Opérateurs épinglés et récemment consultés',
  description: 'Limité aux opérateurs engagés auprès de l\'OC de l\'utilisateur, avec leur parcellaire principal.',
  response: { ...commonErrorResponses, 200: operatorsDashboardResponseSchema.meta({ description: 'Opérateurs épinglés et consultés' }) }
})

export const dashboardSummarySchema = withSchema(protectedWithToken({ oc: true, cartobio: true }), {
  operationId: 'getDashboardSummary',
  tags: [TAGS.TABLEAU_DE_BORD],
  summary: 'Synthèse de certification des opérateurs de l\'OC',
  description: 'Compte les opérateurs engagés en production selon l\'état de leur parcellaire pour l\'année de référence.',
  body: dashboardSummaryBodySchema,
  response: { ...commonErrorResponses, 200: dashboardSummaryResponseSchema.meta({ description: 'Compteurs par état' }) }
})

const operatorRoute = () => withSchema(mergeSchemas(protectedWithToken(), operatorFromNumeroBio), { params: numeroBioParamsSchema })

export const getOperatorSchema = withSchema(operatorRoute(), {
  operationId: 'getOperator',
  tags: [TAGS.OPERATEURS],
  summary: 'Détail d\'un opérateur',
  response: { ...operatorErrorResponses, 200: pinnedOperatorSchema.meta({ description: 'Opérateur Agence Bio et son état d\'épinglage' }) }
})

export const operatorRecordsSchema = withSchema(operatorRoute(), {
  operationId: 'listOperatorRecords',
  tags: [TAGS.PARCELLAIRES],
  summary: 'Parcellaires d\'un opérateur',
  description: 'Si l\'opérateur dépend d\'un autre OC que celui de l\'utilisateur, seuls les parcellaires de l\'OC de l\'utilisateur sont retournés.',
  response: { ...operatorErrorResponses, 200: operatorRecordsResponseSchema.meta({ description: 'Résumés des parcellaires' }) }
})

export const operatorImportPacSchema = withSchema(operatorRoute(), {
  operationId: 'getOperatorImportPac',
  tags: [TAGS.OPERATEURS],
  summary: 'Import PAC 2026 disponible pour l\'opérateur',
  response: { ...operatorErrorResponses, 200: operatorImportPacResponseSchema.meta({ description: 'Données d\'import PAC' }) }
})

const operatorActionRoute = () => withSchema(mergeSchemas(protectedWithToken(), operatorFromNumeroBio, { preHandler: [enforceOperatorAccess()] }), { params: numeroBioStringParamsSchema })

export const pinOperatorSchema = withSchema(operatorActionRoute(), {
  operationId: 'pinOperator',
  tags: [TAGS.OPERATEURS],
  summary: 'Épingler un opérateur',
  response: { ...operatorErrorResponses, 200: pinResponseSchema.meta({ description: 'Opérateur épinglé' }) }
})

export const unpinOperatorSchema = withSchema(operatorActionRoute(), {
  operationId: 'unpinOperator',
  tags: [TAGS.OPERATEURS],
  summary: 'Désépingler un opérateur',
  response: { ...operatorErrorResponses, 200: pinResponseSchema.meta({ description: 'Opérateur désépinglé' }) }
})

export const consultOperatorSchema = withSchema(operatorActionRoute(), {
  operationId: 'consultOperator',
  tags: [TAGS.OPERATEURS],
  summary: 'Marquer un opérateur comme consulté',
  description: 'Alimente la liste des opérateurs récemment consultés du tableau de bord.',
  response: { ...operatorErrorResponses, 204: describedResponse('Consultation enregistrée') }
})

export const hideImportPacNotificationSchema = withSchema(operatorActionRoute(), {
  operationId: 'hideOperatorImportPacNotification',
  tags: [TAGS.OPERATEURS],
  summary: 'Masquer la notification d\'import PAC 2026',
  response: { ...operatorErrorResponses, 204: describedResponse('Notification masquée') }
})
