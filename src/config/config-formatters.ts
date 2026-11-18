import validator from 'validator'

const { isURL, isJWT, isIP, isUUID } = validator

const coerce = (x: unknown): string => String(x)
const coerceMultiline = (x: unknown): string => String(x).replace(/\\n/g, '\n')

export default {
  ipaddress: {
    coerce,
    validate: (x: string) => isIP(x)
  },
  'jwt-token': {
    coerce,
    validate: (x: string) => isJWT(x)
  },
  'pg-url': {
    coerce,
    validate: (x: string) => isURL(x, { protocols: ['pg', 'postgres', 'postgresql'] })
  },
  'pub-key': {
    coerce: coerceMultiline,
    validate: (x: string) => /^-----BEGIN PUBLIC KEY-----(\n|\r|\r\n)([0-9a-zA-Z+/=]{64}(\n|\r|\r\n))*([0-9a-zA-Z+/=]{1,63}(\n|\r|\r\n))?-----END PUBLIC KEY-----\n$/.test(x)
  },
  url: {
    coerce,
    validate: (x: string) => isURL(x, { require_protocol: true })
  },
  uuid: {
    coerce,
    validate: (x: string) => isUUID(x, '4')
  }
}
