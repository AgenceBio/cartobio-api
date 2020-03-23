const http = require('http');
const httpProxy = require('http-proxy');
const httpProxyRules = require('http-proxy-rules');

const {version:apiVersion} = require('./package.json')
const parcelsFixture = require('./test/fixtures/parcels.json')
const {verify:verifyToken} = require('jsonwebtoken')
const JWT_SECRET = Buffer.from(process.env.CARTOBIO_JWT_SECRET, 'base64')

// Application is hosted on localhost:8000 by default
const {
    PORT = 8000, HOST = 'localhost'
} = process.env;

// Remote Endpoints Setup
const {
    ESPACE_COLLABORATIF_ENDPOINT = 'https://espacecollaboratif.ign.fr',
    NOTIFICATIONS_AB_ENDPOINT = 'https://back.agencebio.org'
} = process.env;

const proxyRules = new httpProxyRules({
    rules: {
        '/espacecollaboratif': ESPACE_COLLABORATIF_ENDPOINT,
        '/notifications': NOTIFICATIONS_AB_ENDPOINT,
    },
});

const proxy = httpProxy.createProxyServer({
    ignorePath: true
});

const verify = (req, res) => {
  const token = (req.headers['authorization'] || '').replace(/^Bearer /, '')

  try {
    verifyToken(token, JWT_SECRET)
    res.setHeader("X-Api-Version", apiVersion)
  }
  catch (error) {
    res.statusCode = 401
    res.end(JSON.stringify({ error: "We could not verify the provided token." }))
  }
}

module.exports = http.createServer(function (req, res) {
    // Some clients (like curl) do not provide this value by default
    if (req.headers.origin) {
        res.setHeader('access-control-allow-origin', req.headers.origin);
    }

    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, authorization");
    console.log(req.method, req.url)

    if (['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Content-Type', 'application/json')

      if (req.url === '/api/v1/test') {
        verify(req, res)
        res.statusCode = 200

        return res.end(JSON.stringify({ test: 'OK'}))
      }
      else if (req.url === '/api/v1/parcels') {
        verify(req, res)
        res.statusCode = 200

        return res.end(JSON.stringify(parcelsFixture))
      }
    }

    // handle OPTIONS method
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
    } else {
        // delete host to avoid 404 error in response
        delete req.headers.host;

        // match against proxy rules
        const target = proxyRules.match(req)

        if (target) {
          proxy.web(req, res, {
              target: target + req.url,
              changeOrigin: true
          });
        }
        else {
          res.writeHead(404, {'Content-Type': 'text/plain'})
          res.end('404 Not Found')
        }

    }
}).listen(PORT, HOST, () => console.log(`Running on http://${HOST}:${PORT}`));
