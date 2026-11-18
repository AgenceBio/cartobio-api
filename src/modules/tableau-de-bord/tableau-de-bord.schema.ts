import {
  generalKpiResponseSchema,
  historiqueResponseSchema,
  repetitionsResponseSchema,
  statsQuerySchema,
  tableauBilanResponseSchema,
  tableauErreursResponseSchema,
  topAnomaliesGroupedResponseSchema,
  topAnomaliesResponseSchema
} from '@agencebio/cartobio-types'
import { apiError, commonErrorResponses, protectedWithToken, TAGS, withSchema } from '../../shared/routes.js'
import type { CartobioExtendedRouteShorthandOptions } from '../../shared/routes.js'

const tableauDeBordRoute = (): CartobioExtendedRouteShorthandOptions => protectedWithToken({ oc: true, cartobio: true })

const periode = { from: true, to: true } as const
const paginationRecherche = { ...periode, page: true, limit: true, recherche: true } as const

export const generalKpiSchema = withSchema(tableauDeBordRoute(), {
  operationId: 'getImportsGeneralKpi',
  tags: [TAGS.SUIVI_API_PARCELLAIRE],
  summary: 'Indicateurs généraux des envois',
  querystring: statsQuerySchema.pick(periode),
  response: {
    ...commonErrorResponses,
    200: generalKpiResponseSchema.meta({ description: 'Indicateurs sur la période' })
  }
})

export const tableauBilanSchema = withSchema(tableauDeBordRoute(), {
  operationId: 'getImportsBilan',
  tags: [TAGS.SUIVI_API_PARCELLAIRE],
  summary: 'Bilan des envois',
  description: 'Liste paginée des envois, avec leur résultat et leur effet sur le parcellaire.',
  querystring: statsQuerySchema.pick({
    ...paginationRecherche,
    statuts: true,
    etats: true,
    ordreDate: true
  }),
  response: {
    ...commonErrorResponses,
    200: tableauBilanResponseSchema.meta({ description: "Page d'envois" })
  }
})

export const tableauErreursSchema = withSchema(tableauDeBordRoute(), {
  operationId: 'getImportsErrors',
  tags: [TAGS.SUIVI_API_PARCELLAIRE],
  summary: 'Envois rejetés et leurs erreurs',
  querystring: statsQuerySchema.pick({ ...paginationRecherche, codes: true, ordreDate: true }),
  response: {
    ...commonErrorResponses,
    200: tableauErreursResponseSchema.meta({
      description: "Page d'envois rejetés avec le détail des erreurs"
    })
  }
})

export const historiqueSchema = withSchema(tableauDeBordRoute(), {
  operationId: 'getParcellaireImportsHistory',
  tags: [TAGS.SUIVI_API_PARCELLAIRE],
  summary: "Historique des envois d'un parcellaire",
  description: "Parcellaire identifié par le numéro bio ou le numéro client, et la date d'audit.",
  querystring: statsQuerySchema
    .pick({ numeroBio: true, numeroClient: true, auditDate: true })
    .refine(({ numeroBio, numeroClient }) => numeroBio || numeroClient, {
      message: 'Le numéro bio ou le numéro client est obligatoire'
    }),
  response: {
    ...commonErrorResponses,
    200: historiqueResponseSchema.meta({ description: 'Envois successifs du parcellaire' }),
    400: apiError('Ni numéro bio ni numéro client')
  }
})

export const topAnomaliesSchema = withSchema(tableauDeBordRoute(), {
  operationId: 'getImportsTopAnomalies',
  tags: [TAGS.SUIVI_API_PARCELLAIRE],
  summary: 'Erreurs les plus fréquentes',
  querystring: statsQuerySchema.pick(periode).required(periode),
  response: {
    ...commonErrorResponses,
    200: topAnomaliesResponseSchema.meta({ description: 'Erreurs par code' }),
    400: apiError('Période `from` / `to` absente')
  }
})

export const topAnomaliesGroupedSchema = withSchema(tableauDeBordRoute(), {
  operationId: 'getImportsTopAnomaliesGrouped',
  tags: [TAGS.SUIVI_API_PARCELLAIRE],
  summary: 'Évolution des erreurs les plus fréquentes',
  description: 'Erreurs agrégées par jour ou par semaine selon la durée de la période.',
  querystring: statsQuerySchema.pick(periode).required(periode),
  response: {
    ...commonErrorResponses,
    200: topAnomaliesGroupedResponseSchema.meta({ description: "Séries d'erreurs par code" }),
    400: apiError('Période `from` / `to` absente')
  }
})

export const repetitionsSchema = withSchema(tableauDeBordRoute(), {
  operationId: 'getImportsSuspectStreaks',
  tags: [TAGS.SUIVI_API_PARCELLAIRE],
  summary: 'Envois répétés suspects',
  description: 'Parcellaires ayant au moins 4 envois consécutifs de même issue (tous acceptés ou tous refusés).',
  querystring: statsQuerySchema.pick({ ...paginationRecherche, type: true }).required(periode),
  response: {
    ...commonErrorResponses,
    200: repetitionsResponseSchema.meta({ description: "Page d'alertes, une par série" }),
    400: apiError('Période `from` / `to` absente')
  }
})
