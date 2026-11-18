import {
  exchangeTokenResponseSchema,
  externalExploitationParamsSchema,
  logoutResponseSchema,
  ssoCallbackQuerySchema,
  verifyResponseSchema
} from '@agencebio/cartobio-types'
import {
  apiError,
  commonErrorResponses,
  describedResponse,
  hiddenSchema,
  internalSchema,
  mergeSchemas,
  protectedWithToken,
  TAGS,
  withSchema
} from '../../shared/routes.js'

export const verifySchema = withSchema(mergeSchemas(protectedWithToken({ oc: true, cartobio: true }), internalSchema), {
  operationId: 'verifyToken',
  tags: [TAGS.AUTH],
  summary: 'Identité associée au jeton',
  response: {
    ...commonErrorResponses,
    200: verifyResponseSchema.meta({
      description: "Utilisateur CartoBio, ou organisme certificateur pour un jeton d'API"
    })
  }
})

export const exchangeTokenSchema = withSchema(internalSchema, {
  operationId: 'exchangeNotificationToken',
  tags: [TAGS.AUTH],
  summary: 'Échanger un jeton du portail Notifications contre un jeton CartoBio',
  description: 'Le jeton CartoBio émis est valable 2 heures.',
  response: {
    ...commonErrorResponses,
    200: exchangeTokenResponseSchema.meta({ description: 'Opérateur et jeton CartoBio' }),
    403: apiError("Le compte du jeton n'a pas accès à cet opérateur"),
    404: apiError('Opérateur introuvable')
  }
})

export const devLoginSchema = withSchema(hiddenSchema, {
  operationId: 'devLogin',
  summary: 'Redirection vers la connexion SSO (développement)'
})

export const ssoCallbackSchema = withSchema(hiddenSchema, {
  operationId: 'ssoCallback',
  summary: 'Retour de la connexion SSO Agence Bio',
  description: "Émet un jeton CartoBio et redirige vers le front, sur l'onglet demandé à l'ouverture de la connexion.",
  querystring: ssoCallbackQuerySchema
})

export const logoutSchema = withSchema(
  {},
  {
    operationId: 'logout',
    tags: [TAGS.AUTH],
    summary: 'Se déconnecter',
    description:
      "Révoque le jeton CartoBio passé dans l'entête `Authorization` et renvoie l'URL de déconnexion du SSO.",
    response: { 200: logoutResponseSchema.meta({ description: 'Jeton révoqué' }) }
  }
)

export const externalExploitationSchema = withSchema(
  {},
  {
    operationId: 'openExternalExploitation',
    tags: [TAGS.AUTH],
    summary: 'Ouvrir une exploitation depuis un lien externe',
    description: "Redirige vers la connexion SSO Agence Bio, puis vers la fiche de l'exploitation dans CartoBio.",
    params: externalExploitationParamsSchema,
    response: {
      302: describedResponse('Redirection vers la connexion SSO Agence Bio'),
      400: apiError('Numéro bio invalide')
    }
  }
)
