import type { z } from 'zod'
import { BadGatewayApiError } from '../shared/errors.js'

export function parseApiResponse<T extends z.ZodType>(schema: T, data: unknown, source: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw new BadGatewayApiError(`réponse inattendue de ${source}`, { cause: result.error })
  return result.data
}

export const HTTP_TIMEOUT = { request: 15_000 }
