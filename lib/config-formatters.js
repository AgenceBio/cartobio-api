'use strict'

const isURL = require('validator/lib/isURL')
const isJWT = require('validator/lib/isJWT')
const isIP = require('validator/lib/isIP')

const coerce = (x) => String(x)

module.exports = {
  ipaddress: {
    coerce,
    validate: (x) => isIP(x)
  },
  'jwt-token': {
    coerce,
    validate: (x) => isJWT(x)
  },
  'pg-url': {
    coerce,
    validate: (x) => isURL(x, { protocols: ['pg', 'postgres', 'postgresql'] })
  },
  url: {
    coerce,
    validate: (x) => isURL(x, { require_protocol: true })
  }
}
