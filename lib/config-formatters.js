'use strict'

const isURL = require('validator/lib/isURL')
const isJWT = require('validator/lib/isJWT')
const isIP = require('validator/lib/isIP')
const isUUID = require('validator/lib/isUUID')

const coerce = (x) => String(x)
const coerceMultiline = (x) => String(x).replace(/\\n/g, '\n')

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
  'pub-key': {
    coerce: coerceMultiline,
    validate: (x) => /^-----BEGIN PUBLIC KEY-----(\n|\r|\r\n)([0-9a-zA-Z+/=]{64}(\n|\r|\r\n))*([0-9a-zA-Z+/=]{1,63}(\n|\r|\r\n))?-----END PUBLIC KEY-----\n$/.test(x)
  },
  url: {
    coerce,
    validate: (x) => isURL(x, { require_protocol: true })
  },
  uuid: {
    coerce,
    validate: (x) => isUUID(x, '4')
  }
}
