import { createSigner, createVerifier } from 'fast-jwt'
import config from '../../config/env.js'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { devLoginSchema, exchangeTokenSchema, logoutSchema, ssoCallbackSchema, verifySchema } from './auth.schema.js'
import { cartobioTokenSchema } from './auth.tokens.js'
import { ForbiddenApiError, UnauthorizedApiError } from '../../shared/errors.js'
import * as service from './auth.service.js'
import { decodeAuthState } from './auth.utils.js'

const DURATION_ONE_HOUR = 1000 * 60 * 60

export interface AuthRoutesOptions {
  sign: (payload: object) => string
}

export default async function authenticationRoutes(
  fastify: FastifyInstance,
  options: AuthRoutesOptions
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const { sign } = options
  const verifyIgnoringExpiration = createVerifier({ key: config.get('jwtSecret'), ignoreExpiration: true })
  const signExchangeToken = createSigner({ key: config.get('jwtSecret'), expiresIn: DURATION_ONE_HOUR * 2 })
  app.get('/api/v2/user/verify', verifySchema, async (request, reply) => {
    const { user, organismeCertificateur } = request
    if (!user) return reply.send(organismeCertificateur)

    const { id, nom, prenom, mainGroup } = user
    return reply.send({ id, nom, prenom, mainGroup, organismeCertificateur: user.organismeCertificateur })
  })

  app.get('/api/v2/user/exchangeToken', exchangeTokenSchema, async (request, reply) => {
    const { error, decodedToken } = service.verifyNotificationAuthorization(request.headers.authorization)

    if (error || !decodedToken) {
      throw new UnauthorizedApiError('impossible de vérifier ce jeton', {
        cause: error
      })
    }

    const [operator, userProfile] = await Promise.all([
      service.fetchOperatorByNumeroBio(decodedToken.numeroBio),
      service.getUserProfileById(decodedToken.userId)
    ])

    if (!(await service.canAccessOperator(userProfile, operator))) {
      throw new ForbiddenApiError("ce compte n'a pas accès à cet opérateur.")
    }

    return reply.send({
      operator,
      // @todo use Notification pubkey and time based token to passthrough the requests to both Agence Bio and CartoBio APIs
      token: signExchangeToken(userProfile)
    })
  })

  app.get('/auth-provider/agencebio/login', devLoginSchema, (_request, reply) =>
    reply.redirect('/api/auth-provider/agencebio/login')
  )
  app.get('/api/auth-provider/agencebio/callback', ssoCallbackSchema, async (request, reply) => {
    // forwards to the UI the user-selected tab
    const { mode = '', returnto = '' } = decodeAuthState(request.query.state)
    const { token } = await app.agenceBioOAuth2
      .getAccessTokenFromAuthorizationCodeFlow(request, reply)
      .catch((error: unknown) => {
        throw new UnauthorizedApiError('état de connexion inconnu ou expiré, veuillez vous reconnecter.', {
          cause: error
        })
      })
    const userProfile = await service.getUserProfileFromSSOToken(token.access_token)

    const cartobioToken = sign({ ...userProfile, id_token: token.id_token })

    return reply.redirect(
      `${config.get('frontendUrl')}/login?mode=${encodeURIComponent(mode)}&returnto=${encodeURIComponent(returnto)}#token=${cartobioToken}`
    )
  })

  app.post('/api/auth-provider/logout', logoutSchema, async (request, reply) => {
    const cartobioToken = request.headers.authorization?.split(' ')[1]
    if (!cartobioToken) throw new UnauthorizedApiError("un jeton d'API est nécessaire pour se déconnecter.")
    let payload: unknown
    try {
      payload = verifyIgnoringExpiration(cartobioToken)
    } catch (error) {
      throw new UnauthorizedApiError('impossible de vérifier ce jeton', { cause: error })
    }
    const { id_token: idToken, exp } = cartobioTokenSchema.parse(payload)
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
