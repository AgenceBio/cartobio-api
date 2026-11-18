import { z } from 'zod'
import { jsonString } from '../../src/shared/validation.js'

describe('jsonString', () => {
  const schema = jsonString(z.object({ id: z.number() }))

  test('parse puis valide le contenu JSON', () => {
    expect(schema.parse('{"id":1}')).toEqual({ id: 1 })
  })

  test('signale un JSON invalide', () => {
    const result = schema.safeParse('{id:1}')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('JSON invalide')
  })

  test('applique le schéma au JSON décodé', () => {
    expect(schema.safeParse('{"id":"1"}').success).toBe(false)
  })
})
