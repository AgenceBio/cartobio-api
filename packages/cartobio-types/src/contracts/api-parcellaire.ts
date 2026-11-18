import { z } from 'zod'
import { bboxSchema, dateTimeSchema, outputGeometrySchema } from './common.js'

const nullableString = (description: string) => z.string().nullable().optional().meta({ description })
const stringOrNumber = (description: string) => z.union([z.string(), z.number()]).nullable().optional().meta({ description })

export const outputApiCultureSchema = z.looseObject({
  cpf: z.string().optional().meta({ description: 'Code CPF de la culture', examples: ['01.19.10.8'] }),
  surface: z.number().nullable().optional().meta({ description: 'Surface de la culture, dans l\'unité `unite`' }),
  unite: z.enum(['ha', '%']).optional().meta({ description: 'Unité de la surface' }),
  variete: nullableString('Variété'),
  dateSemis: nullableString('Date de semis')
})

export const outputApiFeaturePropertiesSchema = z.looseObject({
  id: z.string().meta({ description: 'Identifiant de la parcelle' }),
  surface: z.number().meta({ description: 'Surface en hectares, calculée en projection légale' }),
  commune: nullableString('Code INSEE de la commune'),
  cultures: z.array(outputApiCultureSchema),
  niveauConversion: z.string().nullable().optional().meta({ description: 'Niveau de conversion : `CONV`, `AB?`, `C1`, `C2`, `C3` ou `AB`' }),
  dateEngagement: dateTimeSchema.nullable().optional().meta({ description: 'Date d\'engagement en bio' }),
  commentaire: nullableString('Notes de l\'auditeur sur la parcelle'),
  annotations: z.array(z.unknown()).nullable().optional().meta({ description: 'Annotations de l\'auditeur' }),
  dateAjout: dateTimeSchema.nullable().optional().meta({ description: 'Date de création de la parcelle' }),
  dateMiseAJour: dateTimeSchema.nullable().optional().meta({ description: 'Date de dernière modification de la parcelle' }),
  nom: nullableString('Nom de la parcelle'),
  numeroPacage: stringOrNumber('Numéro PACAGE'),
  numeroIlotPAC: stringOrNumber('Numéro d\'îlot PAC'),
  numeroParcellePAC: stringOrNumber('Numéro de parcelle PAC'),
  referenceCadastrale: nullableString('Références cadastrales, séparées par des espaces')
})

export const outputApiParcelleSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: outputGeometrySchema.nullable(),
  properties: outputApiFeaturePropertiesSchema,
  bbox: bboxSchema
})

export const outputApiCertificationSchema = z.looseObject({
  statut: z.string().optional().meta({ description: 'État du parcellaire : `OPERATOR_DRAFT`, `AUDITED`, `PENDING_CERTIFICATION` ou `CERTIFIED`' }),
  dateAudit: dateTimeSchema.nullable().optional().meta({ description: 'Date d\'audit' }),
  dateDebut: dateTimeSchema.nullable().optional().meta({ description: 'Début de validité de la certification' }),
  dateFin: dateTimeSchema.nullable().optional().meta({ description: 'Fin de validité de la certification' }),
  demandesAudit: nullableString('Demandes formulées lors de l\'audit'),
  notesAudit: nullableString('Notes de l\'audit'),
  anneeReferenceControle: z.number().nullable().optional().meta({ description: 'Année de référence du contrôle' })
})

export const outputApiRecordSchema = z.looseObject({
  numeroBio: z.string().meta({ description: 'Numéro bio de l\'opérateur', examples: ['99999'] }),
  version_name: z.string().nullable().meta({ description: 'Nom de la version du parcellaire' }),
  certification: outputApiCertificationSchema,
  parcellaire: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(outputApiParcelleSchema),
    bbox: bboxSchema
  })
})

export const paginationLinksSchema = z.object({
  prev: z.string().nullable().optional().meta({ description: 'URL de la page précédente, `null` sur la première page' }),
  next: z.string().nullable().optional().meta({ description: 'URL de la page suivante, `null` sur la dernière page' })
})

export const certificationParcellairesResponseSchema = z.object({
  data: z.array(outputApiRecordSchema),
  _links: paginationLinksSchema
})

export const importProblemSchema = z.looseObject({
  numeroBio: z.string().optional().meta({ description: 'Numéro bio du parcellaire concerné' }),
  code: z.string().meta({ description: 'Code de l\'anomalie' }),
  message: z.string(),
  idParcelle: z.union([z.string(), z.number()]).optional().meta({ description: 'Identifiant de la parcelle concernée' }),
  nomParcelle: z.string().optional().meta({ description: 'Nom de la parcelle concernée' })
})

export const importReportSchema = z.object({
  jobId: z.number().meta({ description: 'Identifiant du job, à suivre avec `GET /api/v3/import/jobs/{id}`' }),
  nbObjetRecus: z.number().meta({ description: 'Nombre de parcellaires reçus' }),
  nbObjetAcceptes: z.number().meta({ description: 'Nombre de parcellaires acceptés' }),
  nbObjetRefuses: z.number().meta({ description: 'Nombre de parcellaires refusés' }),
  listeNumeroBioValides: z.array(z.string()).optional().meta({ description: 'Numéros bio des parcellaires acceptés' }),
  listeProblemes: z.array(importProblemSchema).optional().meta({ description: 'Anomalies ayant entraîné un refus' })
})

const importStatusSchema = z.enum(['CREATED', 'PENDING', 'DONE', 'ERROR']).meta({ description: 'Statut du job' })

export const importJobStatusResponseSchema = z.looseObject({
  status: importStatusSchema,
  created: dateTimeSchema.optional().meta({ description: 'Date de création, tant que le job n\'est pas terminé' }),
  numeroBio: z.string().nullable().optional().meta({ description: 'Numéro bio du premier parcellaire reçu' }),
  numeroClient: z.string().nullable().optional().meta({ description: 'Numéro client du premier parcellaire reçu' }),
  auditDate: dateTimeSchema.nullable().optional().meta({ description: 'Date d\'audit du premier parcellaire reçu' }),
  result: z.unknown().optional().meta({ description: 'Résultat du job, une fois terminé' }),
  error: z.unknown().optional().meta({ description: 'Erreur du job, en cas d\'échec' }),
  ended: dateTimeSchema.nullable().optional().meta({ description: 'Date de fin du job' })
})

export const importJobNotFoundResponseSchema = z.object({
  status: z.literal('error'),
  error: z.string().meta({ examples: ['Aucun job n\'a cet id'] })
})

export const importSummarySchema = z.looseObject({
  jobId: z.number().optional().meta({ description: 'Identifiant du job' }),
  status: importStatusSchema,
  createdAt: dateTimeSchema.meta({ description: 'Date de réception' }),
  endedAt: dateTimeSchema.nullable().meta({ description: 'Date de fin du traitement' }),
  numeroBio: z.string().nullable().meta({ description: 'Numéro bio du premier parcellaire reçu' }),
  numeroClient: z.string().nullable().meta({ description: 'Numéro client du premier parcellaire reçu' }),
  auditDate: dateTimeSchema.nullable().meta({ description: 'Date d\'audit du premier parcellaire reçu' }),
  result: z.unknown().meta({ description: 'Résultat du traitement' }),
  payload: z.unknown().meta({ description: 'Corps JSON envoyé (`id`, `payload`), si `withPayload=true`' })
})

export const importListResponseSchema = z.object({
  data: z.array(importSummarySchema),
  meta: z.object({
    total: z.number().meta({ description: 'Nombre total d\'envois' }),
    page: z.number(),
    limit: z.number()
  }),
  _links: paginationLinksSchema
})

export const importNotFoundResponseSchema = z.object({
  message: z.string().meta({ examples: ['Import introuvable'] })
})

export type OutputApiRecordResponse = z.infer<typeof outputApiRecordSchema>
export type ImportReport = z.infer<typeof importReportSchema>
export type ImportJobStatusResponse = z.infer<typeof importJobStatusResponseSchema>
export type ImportSummary = z.infer<typeof importSummarySchema>
