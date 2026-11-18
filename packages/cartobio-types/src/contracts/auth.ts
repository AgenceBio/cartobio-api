import { z } from 'zod'
import { operatorSchema } from './operators.js'

export const ssoCallbackQuerySchema = z.looseObject({
  state: z.string().meta({ description: "État OAuth2 émis à l'ouverture de la connexion" }),
  code: z.string().optional().meta({ description: "Code d'autorisation OAuth2" })
})

export const logoutResponseSchema = z.object({
  logoutUrl: z.string().meta({
    description: "URL de déconnexion du SSO Agence Bio vers laquelle rediriger l'utilisateur"
  })
})

export const externalExploitationParamsSchema = z.object({
  numeroBio: z
    .string()
    .regex(/^[1-9]\d*$/)
    .meta({ description: "Numéro bio de l'opérateur" })
})

export const userGroupSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  nom: z.string().nullish()
})

export const organismeCertificateurSchema = z.looseObject({
  id: z.number().meta({ description: "Identifiant de l'OC" }),
  nom: z.string().meta({ description: "Nom de l'OC" }),
  numeroControleEu: z.string().optional().meta({ description: 'Numéro de contrôle européen' }),
  numeroClient: z.string().optional().meta({ description: "Numéro client de l'opérateur chez l'OC" })
})

export const cartobioUserSchema = z.looseObject({
  id: z.number().meta({ description: "Identifiant de l'utilisateur" }),
  nom: z.string(),
  prenom: z.string(),
  mainGroup: userGroupSchema.meta({
    description: 'Groupe principal : `1` admin, `2` OC, `4` opérateur…'
  }),
  groups: z.array(userGroupSchema),
  organismeCertificateur: organismeCertificateurSchema.optional()
})

export const verifyResponseSchema = z
  .union([cartobioUserSchema.omit({ groups: true }), organismeCertificateurSchema])
  .nullable()

export const exchangeTokenResponseSchema = z.object({
  operator: operatorSchema.meta({ description: 'Opérateur concerné par la notification' }),
  token: z.string().meta({ description: 'Jeton CartoBio, valable 2 heures' })
})

export type SsoCallbackQuery = z.infer<typeof ssoCallbackQuerySchema>
export type LogoutResponse = z.infer<typeof logoutResponseSchema>
export type ExternalExploitationParams = z.infer<typeof externalExploitationParamsSchema>
export type AgenceBioUserGroup = z.infer<typeof userGroupSchema>
export type OrganismeCertificateur = z.infer<typeof organismeCertificateurSchema>
export type CartoBioUser = z.infer<typeof cartobioUserSchema>
export type CartoBioOCUser = CartoBioUser & { organismeCertificateur: OrganismeCertificateur }
export type VerifyResponse = z.infer<typeof verifyResponseSchema>
export type ExchangeTokenResponse = z.infer<typeof exchangeTokenResponseSchema>
