import { z } from 'zod'

export function jsonString<T extends z.ZodType>(
  schema: T
): z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<unknown, string>>, T> {
  return z
    .string()
    .transform((text, ctx): unknown => {
      try {
        return JSON.parse(text)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'JSON invalide' })
        return z.NEVER
      }
    })
    .pipe(schema)
}
