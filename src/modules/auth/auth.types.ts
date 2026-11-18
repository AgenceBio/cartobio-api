import type { z } from 'zod'
import type { accessTokenSchema, authStateSchema } from './auth.tokens.js'

export type AuthState = z.infer<typeof authStateSchema>
export type AccessToken = z.infer<typeof accessTokenSchema>

export type RefreshedSession = { userId: number; token?: string; expiresAt?: Date }
