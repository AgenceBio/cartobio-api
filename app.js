var http = require('http'),
    httpProxy = require('http-proxy');


//
// Create a proxy server
// The purpose of this proxy server is to avoid cors block from espacecollaboratif.ign.fr
// It is also to have an access to the notifications portail API
// Simple version for test
//

var proxyOptions = {
    ignorePath: true
};

var proxy = httpProxy.createProxyServer(proxyOptions);

http.createServer(function (req, res) {
    res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, authorization ");

    // handle OPTIONS method
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
    } else {
        // delete host to avoid 404 error in response
        delete req.headers.host;
        proxy.web(req, res, {
            target: 'https://espacecollaboratif.ign.fr' + req.url,
            changeOrigin: true
        });
    }
}).listen(8000);

// add /espacecollaboratif endpoint
// add /notifs endpoint -- needed for prod