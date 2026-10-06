'use strict'

const fp = require('fastify-plugin')
const { CartoBioDecoratorsPlugin } = require('../../src/shared/routes/index.js')

module.exports = fp(CartoBioDecoratorsPlugin, { name: 'auth' })
