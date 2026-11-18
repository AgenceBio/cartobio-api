import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import swagger, { type SwaggerOptions } from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'
import config from '../config/env.js'
import { TAGS } from '../shared/routes.js'

const host = config.get('host')
const port = config.get('port')
const version = config.get('version')

const swaggerConfig: SwaggerOptions = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'CartoBio API',
      version
    },
    servers: [{
      url: config.get('env') === 'production' ? 'https://cartobio.agencebio.org' : `http://${host}:${port}`
    }],
    externalDocs: {
      url: 'https://cartobio.agencebio.org/api',
      description: 'Consulter le guide d\'utilisation de l\'API CartoBio'
    },
    tags: [
      { name: TAGS.SYSTEME, description: 'Version, santé du service et test d\'un jeton d\'accès' },
      { name: TAGS.AUTH, description: 'Connexion SSO Agence Bio et jetons CartoBio' },
      { name: TAGS.API_PARCELLAIRE, description: 'API publique des organismes certificateurs : envoi et consultation des parcellaires' },
      { name: TAGS.SUIVI_API_PARCELLAIRE, description: 'Statistiques et anomalies des envois de l\'API parcellaire' },
      { name: TAGS.OPERATEURS, description: 'Recherche, consultation et épinglage des opérateurs' },
      { name: TAGS.TABLEAU_DE_BORD, description: 'Tableau de bord de l\'application pour les organismes certificateurs' },
      { name: TAGS.PARCELLAIRES, description: 'Création, modification et certification des parcellaires' },
      { name: TAGS.PARCELLES, description: 'Édition des parcelles d\'un parcellaire' },
      { name: TAGS.IMPORT, description: 'Conversion de fichiers et récupération de parcellaires externes (Telepac, RPG, Geofolia, nCVI)' },
      { name: TAGS.GEOMETRIE, description: 'Calculs géographiques sur les parcelles' },
      { name: TAGS.EXPORTS, description: 'Attestations de production et exports de parcellaires' },
      { name: TAGS.REFERENTIELS, description: 'Données de référence' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description: 'Token JWT passé en tant qu\'entête HTTP (donc préfixé par `Bearer `).'
        },
        tokenHeaderAuth: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description: 'Token passé en tant qu\'entête HTTP (donc préfixé par `Token `).'
        },
        agenceBioAuthorizationAuth: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description: 'Token délivré par l\'Agence Bio, passé dans l\'entête HTTP `Authorization`.'
        }
      }
    }
  },
  transform: jsonSchemaTransform
}

async function documentationPlugin (app: FastifyInstance): Promise<void> {
  await app.register(swagger, swaggerConfig)
  await app.register(swaggerUi, { routePrefix: '/api/documentation' })
}

export default fp(documentationPlugin, { name: 'documentation' })
