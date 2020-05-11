'use strict'

const { verify: verifyToken } = require('jsonwebtoken')
const MatomoTracker = require('matomo-tracker')
const env = require('./app.js').env()
const { version: apiVersion } = require('../package.json')

const { NODE_ENV, MATOMO_SITE_ID, MATOMO_TRACKER_URL } = env

const matomo = new MatomoTracker(MATOMO_SITE_ID, MATOMO_TRACKER_URL)

const noop = () => {}

const verify = ({ JWT_SECRET }) => {
  return (request, reply, done) => {
    let token

    try {
      token = (request.headers.authorization || request.query.access_token || '').replace(/^Bearer /, '')
      reply.header('X-Api-Version', apiVersion)
      request.decodedToken = verifyToken(token, JWT_SECRET)
      done()
    } catch (error) {
      matomo.trackBulk([{
        ua: apiVersion,
        cvar: JSON.stringify({ token, error: error.message, NODE_ENV }),
        e_c: 'api/v1',
        e_a: 'error',
        e_n: error.message
      }])

      return reply.code(401).send({
        error: 'We could not verify the provided token.'
      })
    }
  }
}

/**
 * [track description]
 * @type {Object.<Request, APIToken>}
 */
const track = NODE_ENV !== 'dev' ? ({ request, decodedToken }) => {
  const { url = '/' } = request.raw

  matomo.trackBulk([{
    ua: apiVersion,
    cvar: JSON.stringify({ decodedToken, NODE_ENV }),
    e_c: 'api/v1',
    e_a: url,
    e_n: `oc:${decodedToken.ocId}`
  }])
} : noop

/**
 * [enforceParams description]
 * @param  {String[]} params [description]
 * @return {Function(Request, Reply, Function)}        [description]
 */
function enforceParams (...params) {
  return (request, reply, done) => {
    const isValid = !params.some(param => param === undefined)

    if (isValid) {
      return done()
    }

    return reply.code(422).send({
      error: 'Certification body identifier is missing in the token.'
    })
  }
}

module.exports = { verify, track, enforceParams }
