import { z } from 'zod'
import { cartobioUserSchema } from '@agencebio/cartobio-types'

export const userTokenSchema = cartobioUserSchema.partial({ nom: true, prenom: true, groups: true })

export const notificationsTokenSchema = z.looseObject({
  numeroBio: z.union([z.string(), z.number()]).transform(String),
  userId: z.coerce.number().int()
})

export const ssoAccessTokenSchema = z.looseObject({
  sub: z.string()
})

export const cartobioTokenSchema = z.looseObject({
  id_token: z.string().optional(),
  exp: z.number()
})

export const authStateSchema = z.object({
  mode: z.string().optional(),
  returnto: z.string().optional()
})
