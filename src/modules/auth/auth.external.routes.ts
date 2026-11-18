import { randomUUID } from 'node:crypto'
import config from '../../config/env.js'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { externalExploitationSchema } from './auth.schema.js'
import type { AuthRoutesOptions } from './auth.routes.js'
import { InvalidRequestApiError } from '../../shared/errors.js'

export default async function externalRoutes(
  fastify: FastifyInstance,
  { stateCache }: AuthRoutesOptions
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  app.get('/api/v3/external/exploitations/:numeroBio', externalExploitationSchema, async (request, reply) => {
    const { numeroBio } = request.params
    if (!numeroBio || Number.isNaN(Number(numeroBio)) || Number(numeroBio) <= 0)
      throw new InvalidRequestApiError('numeroBio invalide')

    const state = randomUUID()
    stateCache.set(state, { returnto: '/exploitations/' + numeroBio })
    const authUrl = new URL(config.get('notifications.sso.host') + '/oauth2/auth')
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', config.get('notifications.sso.clientId'))
    authUrl.searchParams.set('redirect_uri', config.get('notifications.sso.callbackUri'))
    authUrl.searchParams.set('scope', 'openid')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('login_hint', 'skip_consent')
    return reply.redirect(authUrl.toString())
  })
}
