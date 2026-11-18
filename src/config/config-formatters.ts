import validator from 'validator'

const { isURL, isJWT, isIP, isUUID } = validator

const coerce = (x: unknown): string => String(x)

const check =
  (name: string, isValid: (x: string) => boolean) =>
  (x: string | null): void => {
    if (x !== null && x !== '' && !isValid(x)) throw new Error(`doit être au format ${name}`)
  }
const coerceMultiline = (x: unknown): string => String(x).replace(/\\n/g, '\n')

export default {
  ipaddress: {
    coerce,
    validate: check('ipaddress', (x) => isIP(x))
  },
  'jwt-token': {
    coerce,
    validate: check('jwt-token', (x) => isJWT(x))
  },
  'pg-url': {
    coerce,
    validate: check('pg-url', (x) => isURL(x, { protocols: ['pg', 'postgres', 'postgresql'], require_tld: false }))
  },
  'pub-key': {
    coerce: coerceMultiline,
    validate: check('pub-key', (x) => /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(x))
  },
  'jwt-secret': {
    coerce,
    validate: (x: string): void => {
      if (process.env.NODE_ENV === 'production' && x.length < 32)
        throw new Error('doit contenir au moins 32 caractères')
    }
  },
  url: {
    coerce,
    validate: check('url', (x) =>
      isURL(x, { require_protocol: true, require_valid_protocol: false, require_tld: false })
    )
  },
  'required-url': {
    coerce,
    validate: (x: string): void => {
      if (!x) throw new Error('est obligatoire')
      check('url', (value) => isURL(value, { require_protocol: true, require_tld: false }))(x)
    }
  },
  uuid: {
    coerce,
    validate: check('uuid', (x) => isUUID(x))
  }
}
