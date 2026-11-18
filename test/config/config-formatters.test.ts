import formats from '../../src/config/config-formatters.js'

const PUB_KEY = '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\n'
const UUID = 'b8a7b3c2-6a1d-4e2f-9c3b-1a2b3c4d5e6f'

describe('config-formatters', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test.each([
    ['ipaddress', '127.0.0.1', 'localhost'],
    ['jwt-token', 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.c2lnbmF0dXJl', 'pas-un-jwt'],
    ['pg-url', 'postgres://user:pass@db:5432/cartobio', 'http://db:5432/cartobio'],
    ['url', 'http://localhost:8000', 'localhost'],
    ['uuid', UUID, '1234']
  ] as const)('%s accepte une valeur valide ou vide et refuse une valeur invalide', (name, valid, invalid) => {
    const { validate } = formats[name]
    expect(() => validate(valid)).not.toThrow()
    expect(() => validate('')).not.toThrow()
    expect(() => validate(null as unknown as string)).not.toThrow()
    expect(() => validate(invalid)).toThrow(`doit être au format ${name}`)
  })

  test('pub-key convertit les \\n échappés et valide le format PEM', () => {
    const { coerce, validate } = formats['pub-key']
    const key = coerce(PUB_KEY.replace(/\n/g, '\\n'))

    expect(key).toBe(PUB_KEY)
    expect(() => validate(key)).not.toThrow()
    expect(() => validate('pas une clé')).toThrow('doit être au format pub-key')
  })

  test.each(['pub-key', 'service-token'] as const)('%s est obligatoire en production', (name) => {
    expect(() => formats[name].validate(null)).not.toThrow()

    vi.stubEnv('NODE_ENV', 'production')
    expect(() => formats[name].validate(null)).toThrow('est obligatoire en production')
  })

  test('service-token doit être un uuid', () => {
    expect(() => formats['service-token'].validate(UUID)).not.toThrow()
    expect(() => formats['service-token'].validate('token')).toThrow('doit être au format uuid')
  })

  test('jwt-secret exige 32 caractères en production uniquement', () => {
    expect(() => formats['jwt-secret'].validate('court')).not.toThrow()

    vi.stubEnv('NODE_ENV', 'production')
    expect(() => formats['jwt-secret'].validate('court')).toThrow('doit contenir au moins 32 caractères')
    expect(() => formats['jwt-secret'].validate('x'.repeat(32))).not.toThrow()
  })

  test('required-url refuse une valeur vide ou sans protocole', () => {
    const { validate } = formats['required-url']
    expect(() => validate('https://cartobio.agencebio.org')).not.toThrow()
    expect(() => validate('')).toThrow('est obligatoire')
    expect(() => validate('cartobio.agencebio.org')).toThrow('doit être au format url')
  })
})
