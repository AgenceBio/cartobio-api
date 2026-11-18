import {
  healthAvailableResponseSchema,
  healthUnavailableResponseSchema,
  testResponseSchema,
  versionResponseSchema
} from '@agencebio/cartobio-types'
import { protectedWithToken, TAGS, withSchema } from '../../shared/routes.js'

export const testSchema = withSchema(protectedWithToken({ oc: true, cartobio: true }), {
  operationId: 'testToken',
  tags: [TAGS.SYSTEME],
  summary: "Vérifier un token d'accès",
  description:
    "Permet à un organisme certificateur de valider que son token est accepté par l'API, sans effet de bord.",
  response: { 200: testResponseSchema.meta({ description: 'Token valide' }) }
})

export const versionSchema = withSchema(
  {},
  {
    operationId: 'getVersion',
    tags: [TAGS.SYSTEME],
    summary: "Version de l'API",
    response: { 200: versionResponseSchema.meta({ description: 'Version courante' }) }
  }
)

export const healthSchema = withSchema(
  {},
  {
    operationId: 'getHealth',
    tags: [TAGS.SYSTEME],
    summary: 'État de santé du service',
    description: 'Sonde de supervision. Répond 503 si la base de données est injoignable.',
    response: {
      200: healthAvailableResponseSchema.meta({ description: 'Service opérationnel' }),
      503: healthUnavailableResponseSchema.meta({ description: 'Base de données injoignable' })
    }
  }
)
