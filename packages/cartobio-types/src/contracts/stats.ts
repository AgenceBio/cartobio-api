import { z } from 'zod'
import { dateTimeSchema } from './common.js'

const optionalString = (description: string) => z.string().optional().meta({ description })

export const statsQuerySchema = z.looseObject({
  from: optionalString('Date de début d\'envoi (ISO 8601)'),
  to: optionalString('Date de fin d\'envoi (ISO 8601)'),
  page: optionalString('Numéro de page, à partir de 1'),
  limit: optionalString('Nombre de lignes par page'),
  numeroBio: optionalString('Numéro bio de l\'opérateur'),
  numeroClient: optionalString('Numéro client de l\'opérateur chez l\'OC'),
  auditDate: optionalString('Date d\'audit du parcellaire (YYYY-MM-DD)'),
  recherche: optionalString('Recherche partielle sur le numéro bio ou le numéro client'),
  statuts: optionalString('Résultats du job séparés par des virgules (`VALID`, `REJECTED`, `ERROR`)'),
  codes: optionalString('Codes d\'erreur séparés par des virgules'),
  etats: optionalString('Effets sur le parcellaire séparés par des virgules (`CREATED`, `UPDATED`, `UNKNOWN`)'),
  type: optionalString('Type de série suspecte (au moins 4 envois consécutifs de même issue) : `envois` (acceptés) ou `refus` (rejetés ou en erreur)'),
  ordreDate: optionalString('Tri par date d\'envoi : `asc` ou `desc` (défaut `desc`)')
})

const opt = <T extends z.ZodType>(schema: T, description: string) => schema.nullable().optional().meta({ description })
const text = (description: string) => opt(z.string(), description)
const count = (description: string) => opt(z.number(), description)

const statsMetaSchema = z.object({
  total: z.number().meta({ description: 'Nombre total de lignes' }),
  page: z.number(),
  limit: z.number()
})

export const importErrorDetailSchema = z.looseObject({
  numeroBio: text('Numéro bio du parcellaire concerné'),
  parcelleId: text('Identifiant de la parcelle concernée'),
  parcelleName: text('Nom de la parcelle concernée'),
  code: text('Code de l\'anomalie'),
  message: text('Message de l\'anomalie')
})

const envoiSchema = z.looseObject({
  jobId: z.number().meta({ description: 'Identifiant du job d\'import' }),
  statut: text('Résultat du job : `VALID`, `REJECTED` ou `ERROR`'),
  etat: text('Effet sur le parcellaire : `CREATED`, `UPDATED` ou `UNKNOWN`'),
  createdAt: opt(dateTimeSchema, 'Date de l\'envoi')
})

const parcellaireKeySchema = {
  numeroBio: text('Numéro bio'),
  numeroClient: text('Numéro client chez l\'OC'),
  auditDate: opt(dateTimeSchema, 'Date d\'audit')
}

export const generalKpiResponseSchema = z.object({
  data: z.looseObject({
    totalEnvoyes: z.number().meta({ description: 'Nombre d\'objets reçus' }),
    totalValides: z.number().meta({ description: 'Nombre d\'objets acceptés' }),
    totalRejetes: z.number().meta({ description: 'Nombre d\'objets refusés' }),
    anomaliePlusFrequente: z.looseObject({
      code: text('Code de l\'anomalie'),
      count: count('Nombre d\'occurrences')
    }).nullable().meta({ description: 'Anomalie la plus fréquente, `null` si aucune' })
  })
})

export const tableauBilanResponseSchema = z.object({
  data: z.array(envoiSchema.extend(parcellaireKeySchema)),
  meta: statsMetaSchema
})

export const tableauErreursResponseSchema = z.object({
  data: z.array(envoiSchema.extend({ ...parcellaireKeySchema, details: z.array(importErrorDetailSchema) })),
  meta: statsMetaSchema
})

export const historiqueResponseSchema = z.array(envoiSchema.extend({
  payload: z.unknown().meta({ description: 'Parcellaire envoyé' }),
  erreurs: z.array(importErrorDetailSchema)
}))

export const topAnomaliesResponseSchema = z.object({
  data: z.array(z.looseObject({
    period: opt(dateTimeSchema, 'Début de la période (jour ou semaine)'),
    code: text('Code de l\'anomalie'),
    count: count('Nombre d\'occurrences')
  }))
})

export const topAnomaliesGroupedResponseSchema = z.array(z.looseObject({
  period: opt(dateTimeSchema, 'Début de la période (jour ou semaine)'),
  accepted: count('Objets acceptés sur la période'),
  refused: count('Objets refusés sur la période'),
  errorCount: z.number().meta({ description: 'Nombre total d\'anomalies sur la période' }),
  errors: z.array(z.looseObject({
    code: text('Code de l\'anomalie'),
    count: count('Nombre d\'occurrences')
  }))
}))

export const repetitionsResponseSchema = z.object({
  data: z.array(z.looseObject({
    ...parcellaireKeySchema,
    type: z.enum(['envois', 'refus']).meta({ description: 'Série d\'envois acceptés (`envois`) ou refusés (`refus`)' }),
    envois: z.array(envoiSchema.extend({ erreurs: z.array(importErrorDetailSchema) }))
  })),
  meta: statsMetaSchema
})

export type StatsQuery = z.infer<typeof statsQuerySchema>
