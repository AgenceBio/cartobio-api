import { z } from 'zod'
import { operatorSchema } from './operators.js'

export const ssoCallbackQuerySchema = z.looseObject({
  state: z.string().meta({ description: 'État OAuth2 émis à l\'ouverture de la connexion' }),
  code: z.string().optional().meta({ description: 'Code d\'autorisation OAuth2' })
})

export const logoutResponseSchema = z.object({
  logoutUrl: z.string().meta({ description: 'URL de déconnexion du SSO Agence Bio vers laquelle rediriger l\'utilisateur' })
})

export const externalExploitationParamsSchema = z.object({
  numeroBio: z.string().regex(/^[1-9]\d*$/).meta({ description: 'Numéro bio de l\'opérateur' })
})

const userGroupSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).nullable().optional(),
  nom: z.string().nullable().optional()
})

export const organismeCertificateurSchema = z.looseObject({
  id: z.number().nullable().optional().meta({ description: 'Identifiant de l\'OC' }),
  nom: z.string().nullable().optional().meta({ description: 'Nom de l\'OC' }),
  numeroControleEu: z.string().nullable().optional().meta({ description: 'Numéro de contrôle européen' })
})

export const cartobioUserSchema = z.looseObject({
  id: z.number().meta({ description: 'Identifiant de l\'utilisateur' }),
  nom: z.string().nullable().optional(),
  prenom: z.string().nullable().optional(),
  mainGroup: userGroupSchema.nullable().optional().meta({ description: 'Groupe principal : `1` admin, `2` OC, `4` opérateur…' }),
  groups: z.array(userGroupSchema).nullable().optional(),
  organismeCertificateur: organismeCertificateurSchema.nullable().optional()
})

export const verifyResponseSchema = z.union([cartobioUserSchema, organismeCertificateurSchema]).nullable()

export const exchangeTokenResponseSchema = z.object({
  operator: operatorSchema.meta({ description: 'Opérateur concerné par la notification' }),
  token: z.string().meta({ description: 'Jeton CartoBio, valable 2 heures' })
})

export const departementsResponseSchema = z.record(z.string(), z.array(z.object({
  code: z.string().meta({ description: 'Code du département' }),
  nom: z.string().meta({ description: 'Nom du département' })
}))).meta({ description: 'Départements par région (clé : nom de la région)' })

export type SsoCallbackQuery = z.infer<typeof ssoCallbackQuerySchema>
export type LogoutResponse = z.infer<typeof logoutResponseSchema>
export type ExternalExploitationParams = z.infer<typeof externalExploitationParamsSchema>
