import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { externalExploitationSchema } from './auth.schema.js'

export default async function externalRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  app.get('/api/v3/external/exploitations/:numeroBio', externalExploitationSchema, async (request, reply) => {
    const { numeroBio } = request.params
    const authUrl = new URL(
      await app.agenceBioOAuth2.generateAuthorizationUri(
        Object.assign(request, { query: { returnto: '/exploitations/' + numeroBio } }),
        reply
      )
    )
    authUrl.searchParams.set('login_hint', 'skip_consent')
    return reply.redirect(authUrl.toString())
  })
}
