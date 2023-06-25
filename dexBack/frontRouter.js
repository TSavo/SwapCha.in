var express = require('express');
var { createProxyMiddleware } = require('http-proxy-middleware');

var app = express();

// Proxy for /tokenPrice requests
app.use('/tokenPrice', createProxyMiddleware({ 
  target: 'http://localhost:3001', 
  changeOrigin: true
}));

// Proxy for all other requests
app.use('/', createProxyMiddleware({ 
  target: 'http://localhost:3000', 
  changeOrigin: true 
}));

app.listen(80);
