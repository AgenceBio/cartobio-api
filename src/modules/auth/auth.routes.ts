import { createSigner, createDecoder } from 'fast-jwt'
import config from '../../config/env.js'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { departementsSchema, devLoginSchema, exchangeTokenSchema, logoutSchema, ssoCallbackSchema, verifySchema } from './auth.schema.js'
import { UnauthorizedApiError } from '../../shared/errors.js'
import * as service from './auth.service.js'

import type { LRUMapWithDelete } from 'mnemonist'

const DURATION_ONE_HOUR = 1000 * 60 * 60

export type AuthStateCache = LRUMapWithDelete<string, { mode?: string; returnto?: string }>

export interface AuthRoutesOptions {
  stateCache: AuthStateCache
  sign: (payload: object) => string
}

export default async function authenticationRoutes (fastify: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { stateCache, sign } = options
  app.get(
    '/api/v2/user/verify',
    verifySchema,
    async (request, reply) => {
      const { user, organismeCertificateur } = request

      return reply.send(user ?? organismeCertificateur)
    }
  )

  app.get(
    '/api/v2/user/exchangeToken',
    exchangeTokenSchema,
    async (request, reply) => {
      const { error, decodedToken } = service.verifyNotificationAuthorization(
        request.headers.authorization
      )

      if (error || !decodedToken) {
        throw new UnauthorizedApiError('impossible de vérifier ce jeton', {
          cause: error
        })
      }

      const [operator, userProfile] = await Promise.all([
        service.fetchOperatorByNumeroBio(decodedToken.numeroBio),
        service.getUserProfileById(decodedToken.userId)
      ])

      const sign = createSigner({
        key: config.get('jwtSecret'),
        expiresIn: DURATION_ONE_HOUR * 2
      })

      return reply.send({
        operator,
        // @todo use Notification pubkey and time based token to passthrough the requests to both Agence Bio and CartoBio APIs
        token: sign(userProfile)
      })
    }
  )

  app.get(
    '/api/v2/departements',
    departementsSchema,
    async (request, reply) => {
      const departements = await service.getDepartement()
      return reply.code(200).send(departements)
    }
  )

  app.get('/auth-provider/agencebio/login', devLoginSchema, (request, reply) => reply.redirect('/api/auth-provider/agencebio/login'))
  app.get('/api/auth-provider/agencebio/callback', ssoCallbackSchema, async (request, reply) => {
    // forwards to the UI the user-selected tab
    const state = stateCache.get(request.query.state)
    if (!state) throw new UnauthorizedApiError('état de connexion inconnu ou expiré, veuillez vous reconnecter.')
    const { mode = '', returnto = '' } = state
    const { token } = await app.agenceBioOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const userProfile = await service.getUserProfileFromSSOToken(token.access_token)

    const cartobioToken = sign({ ...userProfile, id_token: token.id_token })

    return reply.redirect(`${config.get('frontendUrl')}/login?mode=${mode}&returnto=${returnto}#token=${cartobioToken}`)
  })

  app.post('/api/auth-provider/logout', logoutSchema, async (request, reply) => {
    const decode = createDecoder()
    const cartobioToken = request.headers.authorization?.split(' ')[1]
    if (!cartobioToken) throw new UnauthorizedApiError('un jeton d\'API est nécessaire pour se déconnecter.')
    const { id_token: idToken, exp } = decode(cartobioToken)
    const ssoHost = config.get('notifications.sso.host')
    const logoutUrl = new URL('/oauth2/sessions/logout', ssoHost)
    if (idToken) {
      logoutUrl.searchParams.set('id_token_hint', idToken)
      logoutUrl.searchParams.set('post_logout_redirect_uri', config.get('frontendUrl'))
    }

    await service.revokeToken(cartobioToken, exp)

    return reply.code(200).send({ logoutUrl: logoutUrl.toString() })
  })

}
