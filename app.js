const http = require('http')
const httpProxy = require('http-proxy')
const HttpProxyRules = require('http-proxy-rules')

const MatomoTracker = require('matomo-tracker')

const { version: apiVersion } = require('./package.json')
const parcelsFixture = require('./test/fixtures/parcels.json')
const { verify: verifyToken } = require('jsonwebtoken')
const JWT_SECRET = Buffer.from(process.env.CARTOBIO_JWT_SECRET, 'base64')

const env = require('./lib/app.js').env()

// Application is hosted on localhost:8000 by default
const {
  PORT, HOST,
  MATOMO_SITE_ID,
  MATOMO_TRACKER_URL,
  NODE_ENV
} = env

// Remote Endpoints Setup
const {
  ESPACE_COLLABORATIF_ENDPOINT,
  NOTIFICATIONS_AB_ENDPOINT
} = env

const matomo = new MatomoTracker(MATOMO_SITE_ID, MATOMO_TRACKER_URL)

const proxyRules = new HttpProxyRules({
  rules: {
    '/espacecollaboratif': ESPACE_COLLABORATIF_ENDPOINT,
    '/notifications': NOTIFICATIONS_AB_ENDPOINT
  }
})

const proxy = httpProxy.createProxyServer({
  ignorePath: true
})

const noop = () => {}
const track = NODE_ENV !== 'dev' ? ({ req, decodedToken }) => {
  const { url = '/' } = req

  matomo.trackBulk([{
    ua: apiVersion,
    cvar: JSON.stringify({ decodedToken, NODE_ENV }),
    e_c: 'api/v1',
    e_a: url,
    e_n: decodedToken.ocId
  }])
} : noop

const verify = (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  let decodedToken
  try {
    decodedToken = verifyToken(token, JWT_SECRET)
    res.setHeader('X-Api-Version', apiVersion)
  } catch (error) {
    matomo.trackBulk([{
      ua: apiVersion,
      cvar: JSON.stringify({ token, error: error.message, NODE_ENV }),
      e_c: 'api/v1',
      e_a: 'error',
      e_n: error.message
    }])
    res.statusCode = 401

    res.end(JSON.stringify({
      error: 'We could not verify the provided token.'
    }))

    return false
  }

  return decodedToken
}

module.exports = http.createServer(function (req, res) {
  // Some clients (like curl) do not provide this value by default
  if (req.headers.origin) {
    res.setHeader('access-control-allow-origin', req.headers.origin)
  }

  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, authorization')

  if (['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Content-Type', 'application/json')

    if (req.url === '/api/v1/test') {
      const decodedToken = verify(req, res, track)
      if (decodedToken) {
        track({ req, decodedToken })
        res.statusCode = 200

        return res.end(JSON.stringify({ test: 'OK' }))
      }
      else if (req.url === '/api/v1/parcels') {
        const decodedToken = verify(req, res, track)
        if (decodedToken) {
          track({req, decodedToken})
          res.statusCode = 200
          return res.end(JSON.stringify(parcelsFixture))
        }
      }
    }
  }

  // do not go any further if a response has been previously sent
  if (res.writableFinished) {
    return
  }

  // handle OPTIONS method
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
  } else {
    // delete host to avoid 404 error in response
    delete req.headers.host

    // match against proxy rules
    const target = proxyRules.match(req)

    if (target) {
      proxy.web(req, res, {
        target: target + req.url,
        changeOrigin: true
      })
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('404 Not Found')
    }
  }
}).listen(PORT, HOST, () => console.log(`Running on http://${HOST}:${PORT}`))
