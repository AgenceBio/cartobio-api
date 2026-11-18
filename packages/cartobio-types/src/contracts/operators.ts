import { z } from 'zod'
import { mixiteSchema, opt, text, textOrNumber } from './helpers.js'
import { CertificationState } from '../enums.js'
import { dateTimeSchema } from './common.js'

const numeroBioDescription = { description: 'Numéro bio de l\'opérateur (Agence Bio)', examples: ['12345'] }

export const numeroBioParamsSchema = z.object({
  numeroBio: z.coerce.number().int().meta(numeroBioDescription)
})

export const numeroBioStringParamsSchema = z.object({
  numeroBio: z.string().meta(numeroBioDescription)
})

export const operatorFilterSchema = z.object({
  departement: z.array(z.string()).nullable().optional().meta({ description: 'Codes de départements' }),
  engagement: z.array(z.string()).nullable().optional().meta({ description: 'Mixité du dernier parcellaire certifié' }),
  pinned: z.boolean().nullable().optional().meta({ description: 'Uniquement les opérateurs épinglés' }),
  etatCertification: z.string().nullable().optional().meta({ description: '`CERTIFIED`, `NO_CERTIFIED` ou `ALL` : parcellaire certifié ou non pour `anneeReferenceCertification`' }),
  anneeReferenceCertification: z.number().nullable().optional().meta({ description: 'Année de référence du contrôle' }),
  etatNotification: z.array(z.string()).nullable().optional().meta({ description: 'États de certification de la notification Agence Bio (etatCertification)' }),
  statutParcellaire: z.array(z.string()).nullable().optional().meta({ description: 'États du parcellaire CartoBio (certification_state)' }),
  sort: z.string().nullable().optional().meta({ description: 'Tri : `nom-ASC`, `nom-DESC`, `date-audit-ASC` ou `date-audit-DESC`' })
})

export const certificationSearchBodySchema = z.object({
  input: z.string().meta({ description: 'Texte recherché (nom, numéro bio, numéro client, SIRET…)' }),
  page: z.int().min(1).default(1).meta({ description: 'Numéro de page (à partir de 1)' }),
  limit: z.int().min(1).max(100).default(7).meta({ description: 'Nombre d\'opérateurs par page (100 maximum)' }),
  filter: operatorFilterSchema.optional()
})

export const autocompleteQuerySchema = z.object({
  search: z.string().optional().meta({ description: 'Texte recherché' })
})

export const userOperatorsQuerySchema = z.object({
  search: z.string().optional().meta({ description: 'Filtre sur la dénomination, le nom, le numéro bio ou le SIRET' }),
  limit: z.coerce.number().int().optional().meta({ description: 'Nombre d\'opérateurs retournés' }),
  offset: z.coerce.number().int().optional().meta({ description: 'Décalage de pagination' })
})

export const dashboardSummaryBodySchema = z.object({
  departements: z.array(z.string()).meta({ description: 'Codes de départements à inclure' }),
  anneeReferenceControle: z.int().meta({ description: 'Année de référence du contrôle' })
})

export const dashboardSummaryResponseSchema = z.object({
  countCertifiees: z.number().meta({ description: 'Opérateurs engagés dont le parcellaire de l\'année est certifié' }),
  countEnAttentes: z.number().meta({ description: 'Opérateurs engagés dont le parcellaire de l\'année est audité mais pas encore certifié' }),
  countNonAuditees: z.number().meta({ description: 'Opérateurs engagés sans parcellaire audité pour l\'année' })
})

export const pinResponseSchema = z.object({
  epingle: z.boolean().meta({ description: 'Nouvel état d\'épinglage' })
})

export const operatorNotificationSchema = z.looseObject({
  id: textOrNumber('Identifiant de la notification Agence Bio'),
  etatCertification: text('État de certification : `ENGAGEE`, `ENGAGEE FUTUR`, `ARRETEE`, `NON ENGAGEE`…'),
  status: text('Statut de la notification'),
  organismeCertificateurId: opt(z.number(), 'Identifiant de l\'OC de la notification'),
  organisme: text('Nom de l\'OC de la notification'),
  numeroClient: text('Numéro client de l\'opérateur chez l\'OC'),
  dateDemarrage: text('Date de démarrage de l\'engagement'),
  dateArret: text('Date d\'arrêt de l\'engagement'),
  activites: opt(z.array(z.unknown()), 'Activités déclarées')
})

export const operatorSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).meta({ description: 'Identifiant Agence Bio de l\'opérateur' }),
  numeroBio: z.union([z.string(), z.number()]).meta({ description: 'Numéro bio' }),
  nom: text('Nom'),
  denominationCourante: text('Dénomination courante'),
  siret: text('SIRET'),
  numeroPacage: text('Numéro PACAGE sur 9 chiffres'),
  email: text('E-mail'),
  dateEngagement: opt(dateTimeSchema, 'Date d\'engagement en bio'),
  datePremierEngagement: opt(dateTimeSchema, 'Date du premier engagement en bio'),
  organismeCertificateur: z.looseObject({
    id: opt(z.number(), 'Identifiant de l\'OC'),
    nom: text('Nom de l\'OC'),
    numeroClient: text('Numéro client chez l\'OC')
  }).meta({ description: 'OC actuel, objet vide si aucun' }),
  adressesOperateurs: z.array(z.looseObject({
    lat: opt(z.number(), 'Latitude'),
    long: opt(z.number(), 'Longitude'),
    codeCommune: text('Code INSEE de la commune'),
    lieu: text('Adresse'),
    codePostal: text('Code postal'),
    ville: text('Ville')
  })).meta({ description: 'Adresses actives' }),
  codeCommune: text('Code INSEE de la première adresse'),
  departement: text('Département de la première adresse'),
  commune: text('Commune de la première adresse'),
  codePostal: text('Code postal de la première adresse'),
  notifications: operatorNotificationSchema.nullable().meta({ description: 'Notification d\'engagement retenue' }),
  isProduction: z.boolean().meta({ description: 'L\'opérateur a une activité de production' })
})

export const pinnedOperatorSchema = operatorSchema.extend({
  epingle: z.boolean().meta({ description: 'L\'opérateur est épinglé par l\'utilisateur' })
})

export const recordSummarySchema = z.looseObject({
  record_id: z.string().meta({ description: 'Identifiant du parcellaire' }),
  numerobio: z.string().meta({ description: 'Numéro bio' }),
  version_name: z.string().meta({ description: 'Nom de la version' }),
  certification_state: z.enum(CertificationState).meta({ description: 'État du parcellaire' }),
  annee_reference_controle: z.number().meta({ description: 'Année de référence du contrôle' }),
  audit_date: z.string().nullable().meta({ description: 'Date d\'audit' }),
  certification_date_debut: z.string().nullable().meta({ description: 'Début de validité de la certification' }),
  certification_date_fin: z.string().nullable().meta({ description: 'Fin de validité de la certification' }),
  created_at: z.string().meta({ description: 'Date de création' }),
  updated_at: z.string().meta({ description: 'Date de dernière modification' }),
  oc_id: z.number().nullable().meta({ description: 'Identifiant de l\'OC ayant créé le parcellaire' }),
  mixite: mixiteSchema.nullable().meta({ description: 'Mixité du parcellaire' }),
  metadata: z.record(z.string(), z.unknown()).meta({ description: 'Métadonnées (source de l\'import…)' }),
  parcelles: z.union([z.string(), z.number()]).meta({ description: 'Nombre de parcelles' }),
  surface: z.number().nullable().meta({ description: 'Surface totale en m², en projection légale' }),
  geojson: opt(z.unknown(), 'FeatureCollection simplifiée des parcelles')
})

export const operatorWithRecordSchema = operatorSchema.extend({
  record_id: text('Identifiant du parcellaire retenu'),
  certification_state: text('État du parcellaire retenu'),
  audit_date: opt(dateTimeSchema, 'Date d\'audit du parcellaire retenu'),
  annee_reference_controle: opt(z.number(), 'Année de référence du contrôle du parcellaire retenu'),
  metadata: opt(z.unknown(), 'Métadonnées du parcellaire retenu'),
  otherParcellaire: opt(z.array(z.unknown()), 'Autres parcellaires en cours')
})

export const operatorSearchResponseSchema = z.object({
  pagination: z.object({
    page: z.number(),
    total: z.number().meta({ description: 'Nombre total d\'opérateurs trouvés' }),
    page_max: z.number().meta({ description: 'Numéro de la dernière page' })
  }),
  records: z.array(operatorWithRecordSchema)
})

export const operatorAutocompleteResponseSchema = z.array(z.looseObject({
  numeroBio: textOrNumber('Numéro bio'),
  nom: text('Nom'),
  denominationCourante: text('Dénomination courante'),
  siret: text('SIRET'),
  numeroClient: text('Numéro client chez l\'OC')
}))

export const userOperatorsResponseSchema = z.object({
  nbTotal: z.number().meta({ description: 'Nombre total d\'opérateurs correspondant à la recherche' }),
  operators: z.array(pinnedOperatorSchema)
})

export const operatorsDashboardResponseSchema = z.object({
  pinnedOperators: z.array(operatorWithRecordSchema.extend({ epingle: z.boolean() })),
  consultedOperators: z.array(operatorWithRecordSchema.extend({ epingle: z.boolean() }))
})

export const operatorRecordsResponseSchema = z.array(recordSummarySchema)

export const operatorImportPacResponseSchema = z.object({
  data: z.looseObject({
    size: textOrNumber('Taille du fichier PAC'),
    nb_parcelles: textOrNumber('Nombre de parcelles'),
    pacage: text('Numéro PACAGE'),
    imported: opt(z.boolean(), 'Le parcellaire a déjà été importé'),
    record: opt(z.unknown(), 'Parcellaire PAC à importer')
  }).nullable().meta({ description: 'Données d\'import PAC, `null` si aucune' })
})

export type NumeroBioParams = z.infer<typeof numeroBioParamsSchema>
export type OperatorFilterInput = z.infer<typeof operatorFilterSchema>
export type CertificationSearchBody = z.infer<typeof certificationSearchBodySchema>
export type AutocompleteQuery = z.infer<typeof autocompleteQuerySchema>
export type UserOperatorsQuery = z.infer<typeof userOperatorsQuerySchema>
export type DashboardSummaryBody = z.infer<typeof dashboardSummaryBodySchema>
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>
export type PinResponse = z.infer<typeof pinResponseSchema>
export type AgenceBioNormalizedOperator = z.infer<typeof operatorSchema>
export type OperatorAutocompleteResponse = z.infer<typeof operatorAutocompleteResponseSchema>
export type AgenceBioNormalizedOperatorWithPinnedStatus = z.infer<typeof pinnedOperatorSchema>
export type AgenceBioNormalizedOperatorWithRecord = z.infer<typeof operatorWithRecordSchema>
export type NormalizedRecordSummary = z.infer<typeof recordSummarySchema>
