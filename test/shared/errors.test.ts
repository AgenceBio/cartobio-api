import { z } from 'zod'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import {
  NotFoundApiError,
  errorHandler,
  getErrorCode,
  getErrorMessage,
  getResponseStatusCode,
  isHandledError
} from '../../src/shared/errors.js'

const reply = () => {
  const mock = { code: vi.fn(), send: vi.fn() }
  mock.code.mockReturnValue(mock)
  mock.send.mockReturnValue(mock)
  return mock
}
const request = () => ({ log: { error: vi.fn(), warn: vi.fn() } })
const handle = (error: unknown) => {
  const r = reply()
  const req = request()
  errorHandler(error as FastifyError, req as unknown as FastifyRequest, r as unknown as FastifyReply)
  return { reply: r, request: req, sent: r.send.mock.calls[0]![0] }
}

describe('helpers', () => {
  test('getErrorCode remonte la chaîne des causes', () => {
    expect(getErrorCode({ code: 'A' })).toBe('A')
    expect(getErrorCode(new Error('x', { cause: new Error('y', { cause: { code: '23505' } }) }))).toBe('23505')
    expect(getErrorCode(new Error('x'))).toBeUndefined()
    expect(getErrorCode(null)).toBeUndefined()
  })

  test('getErrorMessage accepte toute valeur', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
    expect(getErrorMessage('texte')).toBe('texte')
  })

  test('getResponseStatusCode lit le statut HTTP', () => {
    expect(getResponseStatusCode({ response: { statusCode: 404 } })).toBe(404)
    expect(getResponseStatusCode({ response: {} })).toBeUndefined()
    expect(getResponseStatusCode(new Error())).toBeUndefined()
  })

  test.each([
    [400, true],
    [499, true],
    [500, false],
    [302, false],
    ['400', false],
    [undefined, false]
  ])('isHandledError(%s) = %s', (statusCode, expected) => {
    expect(isHandledError({ statusCode })).toBe(expected)
  })
})

describe('errorHandler', () => {
  test('transforme une ZodError en erreur 400', () => {
    const error = z.object({ id: z.number() }).safeParse({ id: 'a' }).error

    const { sent } = handle(error)

    expect(sent).toMatchObject({ statusCode: 400, code: 'INVALID_API_REQUEST' })
    expect(sent.message).toContain('id')
  })

  test('transforme une erreur de validation Fastify en erreur 400', () => {
    const { sent } = handle(Object.assign(new Error('body/id must be number'), { validation: [{}] }))

    expect(sent).toMatchObject({ statusCode: 400, message: 'body/id must be number' })
  })

  test('traduit un code commune inconnu', () => {
    const dbError = new Error('insert failed', {
      cause: { constraint: 'parcelles_commune_communes_fid_fkey' }
    })

    expect(handle(dbError).sent).toMatchObject({ statusCode: 400, message: 'Code commune inconnu.' })
  })

  test('expose une erreur gérée avec son statut', () => {
    const error = new NotFoundApiError('Parcellaire introuvable')
    const { reply: r, sent } = handle(error)

    expect(r.code).toHaveBeenCalledWith(404)
    expect(sent).toBe(error)
  })

  test('expose une erreur de passerelle', () => {
    const error = Object.assign(new Error('Erreur serveur : API'), { statusCode: 502 })
    const { reply: r, sent } = handle(error)

    expect(r.code).toHaveBeenCalledWith(502)
    expect(sent).toBe(error)
  })

  test('masque les erreurs internes et les journalise', () => {
    const error = new Error('mot de passe de la base invalide')
    const { request: req, sent } = handle(error)

    expect(req.log.error).toHaveBeenCalledWith({ err: error }, 'mot de passe de la base invalide')
    expect(sent).toBeInstanceOf(Error)
    expect(sent.message).toBe('Erreur serveur. Nous avons été informés et résoudrons ceci au plus vite.')
  })
})
