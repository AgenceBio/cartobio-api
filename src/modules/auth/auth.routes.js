'use strict'

const { createSigner, createDecoder } = require('fast-jwt')
const config = require('../../../src/config/env.js')
const { mergeSchemas, protectedWithToken, sandboxSchema, internalSchema, hiddenSchema } = require('./auth.schema.js')
const { UnauthorizedApiError } = require('../../../src/shared/errors.js')
const service = require('./auth.service.js')

const DURATION_ONE_HOUR = 1000 * 60 * 60

module.exports = async function authenticationRoutes (app, options) {
  const { stateCache, sign } = options
  app.get(
    '/api/v2/user/verify',
    mergeSchemas(
      protectedWithToken({ oc: true, cartobio: true }),
      sandboxSchema,
      internalSchema
    ),
    (request, reply) => {
      const { user, organismeCertificateur } = request

      return reply.send(user ?? organismeCertificateur)
    }
  )

  /**
   * Exchange a notification.agencebio.org token for a CartoBio token
   */
  app.get(
    '/api/v2/user/exchangeToken',
    internalSchema,
    async (request, reply) => {
      const { error, decodedToken, token } = service.verifyNotificationAuthorization(
        request.headers.authorization
      )

      if (error) {
        return new UnauthorizedApiError('impossible de vérifier ce jeton', {
          cause: error
        })
      }

      const [operator, userProfile] = await Promise.all([
        service.fetchOperatorByNumeroBio(decodedToken.numeroBio, token),
        service.getUserProfileById(decodedToken.userId, token)
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
    mergeSchemas(protectedWithToken()),
    async (request, reply) => {
      const departements = await service.getDepartement()
      return reply.code(200).send(departements)
    }
  )

  // usefull only in dev mode
  app.get('/auth-provider/agencebio/login', hiddenSchema, (request, reply) => reply.redirect('/api/auth-provider/agencebio/login'))
  app.get('/api/auth-provider/agencebio/callback', mergeSchemas(sandboxSchema, hiddenSchema), async (request, reply) => {
    // forwards to the UI the user-selected tab
    const { mode = '', returnto = '' } = stateCache.get(request.query.state)
    const { token } = await app.agenceBioOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const userProfile = await service.getUserProfileFromSSOToken(token.access_token)

    const cartobioToken = sign({ ...userProfile, id_token: token.id_token })

    return reply.redirect(`${config.get('frontendUrl')}/login?mode=${mode}&returnto=${returnto}#token=${cartobioToken}`)
  })

  app.post('/api/auth-provider/logout', async (request, reply) => {
    const decode = createDecoder()
    const cartobioToken = request.headers.authorization?.split(' ')[1]
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
