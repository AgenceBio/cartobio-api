import { z } from 'zod'
import { userGroupSchema } from '@agencebio/cartobio-types'

export const agenceBioActivitySchema = z.looseObject({
  id: z.number(),
  nom: z.string()
})

export const agenceBioNotificationSchema = z.looseObject({
  id: z.number().nullish(),
  dateArret: z.string().nullish(),
  dateDemarrage: z.string().nullish(),
  etatCertification: z.string().nullish(),
  numeroClient: z.string().nullish(),
  status: z.string().nullish(),
  organismeCertificateurId: z.number().nullish(),
  organisme: z.string().nullish(),
  activites: z.array(agenceBioActivitySchema).nullish(),
  numeroBio: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  changementDate: z.string().nullish(),
  _oldOC: z.unknown().optional(),
  certification_state: z.string().nullish()
})

/**
 * This is what we output
 */
export const agenceBioAdresseGeoSchema = z.looseObject({
  codeCommune: z.string().nullish(),
  lat: z.number().nullish(),
  long: z.number().nullish()
})

/**
 * This is what we consume
 */
export const agenceBioAdressesSchema = agenceBioAdresseGeoSchema.extend({
  active: z.boolean().nullish(),
  lieu: z.string().nullish(),
  dates: z.string().nullish(),
  codePostal: z.string().nullish(),
  ville: z.string().nullish()
})

/**
 * An operator as returned by Agence Bio API
 */
export const agenceBioOperatorSchema = z.looseObject({
  id: z.number(),
  nom: z.string().nullish(),
  denominationCourante: z.string().nullish(),
  siret: z.string().nullish(),
  echeanceSiret: z.string().nullish(),
  flag: z.string().nullish(),
  numeroBio: z.union([z.string(), z.number()]).transform(String),
  echangeSiret: z.string().nullish(),
  email: z.string().nullish(),
  gerant: z.string().nullish(),
  telephone: z.string().nullish(),
  telephoneCommerciale: z.string().nullish(),
  numeroPacage: z.string().nullish(),
  dateFinConversion: z.string().nullish(),
  lat: z.number().nullish(),
  long: z.number().nullish(),
  mandate: z.boolean().nullish(),
  dateMaj: z.string().nullish(),
  dateEngagement: z.string().nullish(),
  datePremierEngagement: z.string().nullish(),
  codeNAF: z.string().nullish(),
  reseauId: z.number().nullish(),
  departementId: z.number().nullish(),
  photo: z.array(z.unknown()).nullish(),
  sitesWeb: z.array(z.string()).nullish(),
  notifications: z.array(agenceBioNotificationSchema).nullish(),
  adressesOperateurs: z.array(agenceBioAdressesSchema).nullish()
})

export const agenceBioOperateursPageSchema = z.looseObject({
  nbTotal: z.number(),
  operateurs: z.array(agenceBioOperatorSchema)
})

export const agenceBioOperatorEmailsSchema = z.looseObject({
  numerobio: z.string().optional(),
  utilisateurs: z.array(z.looseObject({ email: z.string() }))
})

export const agenceBioUserProfileSchema = z.looseObject({
  id: z.number(),
  prenom: z.string().nullish(),
  nom: z.string().nullish(),
  organismeCertificateurId: z.number().nullish(),
  groupes: z.array(userGroupSchema)
})

export const agenceBioUserByEmailSchema = z.looseObject({
  id: z.number()
})

export type AgenceBioOperator = z.infer<typeof agenceBioOperatorSchema>
export type AgenceBioNotification = z.infer<typeof agenceBioNotificationSchema>
export type AgenceBioAdresseGeo = z.infer<typeof agenceBioAdresseGeoSchema>
export type AgenceBioAdresses = z.infer<typeof agenceBioAdressesSchema>
export type AgenceBioOperateursPage = z.infer<typeof agenceBioOperateursPageSchema>
/**
 * Only some endpoints provide this data
 */
export type AgenceBioOperatorWithAdresses = AgenceBioOperator & {
  adressesOperateurs: AgenceBioAdresses[]
}
export type AgenceBioOperatorEmails = z.infer<typeof agenceBioOperatorEmailsSchema>
export type AgenceBioActivity = z.infer<typeof agenceBioActivitySchema>
export type AgenceBioProduction = {
  id: number
  nom: string
  parent: number
}
