'use strict'

const { randomUUID } = require('node:crypto')
const config = require('../../../src/config/env.js')
const { externalExploitationSchema } = require('./auth.schema.js')

module.exports = async function externalRoutes (app, { stateCache }) {
  app.get('/api/v3/external/exploitations/:numeroBio', externalExploitationSchema, async (request, reply) => {
    const { numeroBio } = request.params
    if (!numeroBio || Number.isNaN(Number(numeroBio)) || Number(numeroBio) <= 0) return reply.status(400).send('numeroBio invalide')

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
