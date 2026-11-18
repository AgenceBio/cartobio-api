import { z } from 'zod'

const userIdSchema = z.coerce.number().int().positive()

export const accessTokenSchema = z.discriminatedUnion('typ', [
  z.looseObject({ typ: z.literal('session'), sub: userIdSchema }),
  z.looseObject({ typ: z.literal('exchange'), sub: userIdSchema, numeroBio: z.string().regex(/^\d+$/) })
])

export const notificationsTokenSchema = z.looseObject({
  numeroBio: z.union([z.string(), z.number()]).transform(String),
  userId: z.coerce.number().int()
})

export const ssoAccessTokenSchema = z.looseObject({
  sub: z.string()
})

export const authStateSchema = z.object({
  mode: z.string().optional(),
  returnto: z.string().optional()
})
