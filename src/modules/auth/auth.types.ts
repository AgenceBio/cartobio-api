import type { z } from 'zod'
import type { authStateSchema } from './auth.tokens.js'

export type AuthState = z.infer<typeof authStateSchema>
