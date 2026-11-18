import type { z } from 'zod'
import { BadGatewayApiError } from '../shared/errors.js'
import { logger } from '../config/logger.js'

export function parseApiResponse<T extends z.ZodType>(schema: T, data: unknown, source: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw new BadGatewayApiError(`réponse inattendue de ${source}`, { cause: result.error })
  return result.data
}

export function parseApiList<T extends z.ZodType>(schema: T, items: unknown[], source: string): Array<z.output<T>> {
  const results = items.map((item) => schema.safeParse(item))
  const invalid = results.flatMap((result) => (result.success ? [] : [result.error]))
  if (invalid.length > 0) {
    logger.warn({ errors: invalid.slice(0, 5) }, `${invalid.length} élément(s) inattendu(s) ignoré(s) dans ${source}`)
  }
  return results.flatMap((result) => (result.success ? [result.data] : []))
}

export const HTTP_TIMEOUT = { request: 15_000 }
