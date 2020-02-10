const http = require('http');
const httpProxy = require('http-proxy');
const httpProxyRules = require('http-proxy-rules');

// Application is hosted on localhost:8000 by default
const {PORT=8000, IP='127.0.0.1'} = process.env;

// Remote Endpoints Setup
const {ESPACE_COLLABORATIF_ENDPOINT='https://espacecollaboratif.ign.fr'} = process.env;
const {NOTIFICATIONS_AB_ENDPOINT='https://notifications.agencebio.org:444'} = process.env;

const proxyRules = new httpProxyRules({
    rules: {
      '/espacecollaboratif': ESPACE_COLLABORATIF_ENDPOINT,
      '/notifications': NOTIFICATIONS_AB_ENDPOINT,
    },
    // remove this line to drop backward compatibility (eg: front-end app)
    default: ESPACE_COLLABORATIF_ENDPOINT
  });

const proxy = httpProxy.createProxyServer({
    ignorePath: true
});

module.exports = http.createServer(function (req, res) {
    // Some clients (like curl) do not provide this value by default
    if (req.headers.origin) {
      res.setHeader('access-control-allow-origin', req.headers.origin);
    }

    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, authorization");

    // handle OPTIONS method
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
    }
    else {
      // delete host to avoid 404 error in response
      delete req.headers.host;

      // match against proxy rules
      const target = proxyRules.match(req)
      proxy.web(req, res, {
          target: target + req.url,
          changeOrigin: true
      });
    }
}).listen(PORT, IP);
