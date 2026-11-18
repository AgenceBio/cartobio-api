import { z } from 'zod'
import { ImportJobEtat, ImportJobResult } from '../enums.js'
import { optionalString } from './helpers.js'
import { isoDateSchema, isoDateTimeSchema, optionalIsoDateQuerySchema } from './common.js'

export const STATS_MAX_LIMIT = 100

const csvListSchema = z.string().transform((value) => value.split(',').filter(Boolean))

export const statsQuerySchema = z.object({
  from: optionalIsoDateQuerySchema.meta({ description: "Date de début d'envoi (ISO 8601)" }),
  to: optionalIsoDateQuerySchema.meta({ description: "Date de fin d'envoi (ISO 8601)" }),
  page: z.coerce.number().int().min(1).optional().meta({ description: 'Numéro de page, à partir de 1' }),
  limit: z.coerce
    .number()
    .int()
    .min(0)
    .max(STATS_MAX_LIMIT)
    .optional()
    .meta({ description: `Nombre de lignes par page (défaut 20, ${STATS_MAX_LIMIT} maximum)` }),
  numeroBio: optionalString("Numéro bio de l'opérateur"),
  numeroClient: optionalString("Numéro client de l'opérateur chez l'OC"),
  auditDate: optionalIsoDateQuerySchema.meta({
    description: "Date d'audit du parcellaire (YYYY-MM-DD)"
  }),
  recherche: optionalString('Recherche partielle sur le numéro bio ou le numéro client'),
  statuts: csvListSchema
    .pipe(z.array(z.enum(['VALID', 'REJECTED', 'ERROR'])))
    .optional()
    .meta({
      description: 'Résultats du job séparés par des virgules (`VALID`, `REJECTED`, `ERROR`)'
    }),
  codes: optionalString("Codes d'erreur séparés par des virgules"),
  etats: csvListSchema
    .pipe(z.array(z.enum(['CREATED', 'UPDATED', 'UNKNOWN'])))
    .optional()
    .meta({
      description: 'Effets sur le parcellaire séparés par des virgules (`CREATED`, `UPDATED`, `UNKNOWN`)'
    }),
  type: z.enum(['envois', 'refus']).optional().catch(undefined).meta({
    description:
      'Type de série suspecte (au moins 4 envois consécutifs de même issue) : `envois` (acceptés) ou `refus` (rejetés ou en erreur). Toute autre valeur : les deux'
  }),
  ordreDate: z
    .enum(['asc', 'desc'])
    .optional()
    .meta({ description: "Tri par date d'envoi : `asc` ou `desc` (défaut `desc`)" })
})

const count = (description: string): z.ZodNumber => z.number().meta({ description })
const nullableText = (description: string): z.ZodNullable<z.ZodString> => z.string().nullable().meta({ description })
const requiredText = (description: string): z.ZodString => z.string().meta({ description })

const statsMetaSchema = z.object({
  total: z.number().meta({ description: 'Nombre total de lignes' }),
  page: z.number(),
  limit: z.number()
})

export const importErrorDetailSchema = z.looseObject({
  numeroBio: nullableText('Numéro bio du parcellaire concerné'),
  parcelleId: nullableText('Identifiant de la parcelle concernée'),
  parcelleName: nullableText('Nom de la parcelle concernée'),
  code: requiredText("Code de l'anomalie (voir `ImportLogCode`)"),
  message: requiredText("Message de l'anomalie")
})

const envoiSchema = z.looseObject({
  jobId: z.number().meta({ description: "Identifiant du job d'import" }),
  statut: z.enum(ImportJobResult).nullable().meta({
    description: 'Résultat du job : `VALID`, `REJECTED` ou `ERROR`, `null` tant que le job est en cours'
  }),
  etat: z.enum(ImportJobEtat).meta({ description: 'Effet sur le parcellaire : `CREATED`, `UPDATED` ou `UNKNOWN`' }),
  createdAt: isoDateTimeSchema.meta({ description: "Date de l'envoi" })
})

const parcellaireKeySchema = {
  numeroBio: nullableText('Numéro bio'),
  numeroClient: nullableText("Numéro client chez l'OC"),
  auditDate: isoDateSchema.nullable().meta({ description: "Date d'audit" })
}

export const generalKpiResponseSchema = z.object({
  data: z.looseObject({
    totalEnvoyes: z.number().meta({ description: "Nombre d'objets reçus" }),
    totalValides: z.number().meta({ description: "Nombre d'objets acceptés" }),
    totalRejetes: z.number().meta({ description: "Nombre d'objets refusés" }),
    anomaliePlusFrequente: z
      .looseObject({
        code: requiredText("Code de l'anomalie"),
        count: count("Nombre d'occurrences")
      })
      .nullable()
      .meta({ description: 'Anomalie la plus fréquente, `null` si aucune' })
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

export const historiqueResponseSchema = z.array(
  envoiSchema.extend({
    payload: z.unknown().meta({ description: 'Parcellaire envoyé' }),
    erreurs: z.array(importErrorDetailSchema)
  })
)

export const topAnomaliesResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      period: isoDateTimeSchema.meta({ description: 'Début de la période (jour ou semaine)' }),
      code: requiredText("Code de l'anomalie"),
      count: count("Nombre d'occurrences")
    })
  )
})

export const topAnomaliesGroupedResponseSchema = z.array(
  z.looseObject({
    period: isoDateTimeSchema.meta({ description: 'Début de la période (jour ou semaine)' }),
    accepted: count('Objets acceptés sur la période'),
    refused: count('Objets refusés sur la période'),
    errorCount: z.number().meta({ description: "Nombre total d'anomalies sur la période" }),
    errors: z.array(
      z.looseObject({
        code: requiredText("Code de l'anomalie"),
        count: count("Nombre d'occurrences")
      })
    )
  })
)

export const repetitionsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      ...parcellaireKeySchema,
      type: z
        .enum(['envois', 'refus'])
        .meta({ description: "Série d'envois acceptés (`envois`) ou refusés (`refus`)" }),
      envois: z.array(envoiSchema.extend({ erreurs: z.array(importErrorDetailSchema) }))
    })
  ),
  meta: statsMetaSchema
})

export type StatsQuery = z.infer<typeof statsQuerySchema>
export type StatsQueryInput = z.input<typeof statsQuerySchema>
export type ImportErrorDetail = z.infer<typeof importErrorDetailSchema>
export type GeneralKpiResponse = z.infer<typeof generalKpiResponseSchema>
export type TableauBilanResponse = z.infer<typeof tableauBilanResponseSchema>
export type TableauErreursResponse = z.infer<typeof tableauErreursResponseSchema>
export type HistoriqueResponse = z.infer<typeof historiqueResponseSchema>
export type TopAnomaliesResponse = z.infer<typeof topAnomaliesResponseSchema>
export type TopAnomaliesGroupedResponse = z.infer<typeof topAnomaliesGroupedResponseSchema>
export type RepetitionsResponse = z.infer<typeof repetitionsResponseSchema>
