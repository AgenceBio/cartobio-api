import config from '../../config/env.js'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  devLoginSchema,
  exchangeTokenSchema,
  logoutSchema,
  refreshSchema,
  ssoCallbackSchema,
  verifySchema
} from './auth.schema.js'
import { ForbiddenApiError, InvalidCredentialsApiError, UnauthorizedApiError } from '../../shared/errors.js'
import * as service from './auth.service.js'
import { fetchOperatorByNumeroBio } from '../../clients/agence-bio.client.js'
import { decodeAuthState, userRoles } from './auth.utils.js'

const SESSION_COOKIE = 'cartobio_session'
const SESSION_COOKIE_PATH = '/api/auth-provider'

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    expires: expiresAt
  })
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: SESSION_COOKIE_PATH, httpOnly: true, secure: true, sameSite: 'strict' })
}

export default async function authenticationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/api/v2/user/verify', verifySchema, async (request, reply) => {
    const { user, organismeCertificateur } = request
    if (!user) return reply.send(organismeCertificateur)

    return reply.send({ ...user, roles: userRoles(user) })
  })

  app.get('/api/v2/user/exchangeToken', exchangeTokenSchema, async (request, reply) => {
    const { error, decodedToken } = service.verifyNotificationAuthorization(request.headers.authorization)

    if (error || !decodedToken) {
      throw new UnauthorizedApiError('impossible de vérifier ce jeton', {
        cause: error
      })
    }

    const [operator, userProfile] = await Promise.all([
      fetchOperatorByNumeroBio(decodedToken.numeroBio),
      service.getUserProfileById(decodedToken.userId)
    ])

    if (!(await service.canAccessOperator(userProfile, operator))) {
      throw new ForbiddenApiError("ce compte n'a pas accès à cet opérateur.")
    }

    return reply.send({
      operator,
      token: service.signExchangeToken(userProfile.id, String(operator.numeroBio))
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
    const session = await service.createSession(userProfile.id, token.id_token ?? null)

    setSessionCookie(reply, session.token, session.expiresAt)
    return reply.redirect(
      `${config.get('frontendUrl')}/login?mode=${encodeURIComponent(mode)}&returnto=${encodeURIComponent(returnto)}`
    )
  })

  app.post('/api/auth-provider/refresh', refreshSchema, async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE]
    if (!sessionToken) throw new InvalidCredentialsApiError('aucune session, veuillez vous connecter.')

    const session = await service.refreshSession(sessionToken).catch((error: unknown) => {
      clearSessionCookie(reply)
      throw error
    })
    if (session.token && session.expiresAt) setSessionCookie(reply, session.token, session.expiresAt)

    return reply.send({ token: service.signAccessToken(session.userId) })
  })

  app.post('/api/auth-provider/logout', logoutSchema, async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE]
    const idToken = sessionToken ? await service.endSession(sessionToken) : null
    clearSessionCookie(reply)

    const logoutUrl = new URL('/oauth2/sessions/logout', config.get('notifications.sso.host'))
    if (idToken) {
      logoutUrl.searchParams.set('id_token_hint', idToken)
      logoutUrl.searchParams.set('post_logout_redirect_uri', config.get('frontendUrl'))
    }

    return reply.code(200).send({ logoutUrl: logoutUrl.toString() })
  })
}
