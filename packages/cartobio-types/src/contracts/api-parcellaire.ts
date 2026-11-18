import { z } from 'zod'
import { text, textOrNumber } from './helpers.js'
import { EtatProduction } from '../enums.js'
import { bboxSchema, dateTimeSchema, outputGeometrySchema } from './common.js'

const numberOrString = (description: string): z.ZodUnion<readonly [z.ZodNumber, z.ZodString]> =>
  z.union([z.number(), z.string()]).meta({ description })

export const inputApiCultureSchema = z.object({
  codeCPF: z.string().meta({ description: 'Code CPF de la culture' }),
  dateSemis: z.string().optional().meta({ description: 'Date de semis' }),
  variete: z.string().optional().meta({ description: 'Variété' }),
  quantite: numberOrString("Surface de la culture, dans l'unité `unite`"),
  unite: z.enum(['ha', '%']).optional().meta({ description: 'Unité de la surface' })
})

export const inputApiParcelleSchema = z.object({
  id: numberOrString('Identifiant de la parcelle'),
  dateEngagement: z.string().meta({ description: "Date d'engagement en bio" }),
  etatProduction: z.enum(EtatProduction).meta({ description: 'Niveau de conversion' }),
  numeroIlot: z.string().optional().meta({ description: "Numéro d'îlot PAC" }),
  commune: z.string().optional().meta({ description: 'Code INSEE de la commune' }),
  nom: z.string().optional().meta({ description: 'Nom de la parcelle' }),
  numeroParcelle: z.string().optional().meta({ description: 'Numéro de parcelle PAC' }),
  commentaire: z.string().optional().meta({ description: "Notes de l'auditeur sur la parcelle" }),
  codeCulture: z.string().optional().meta({ description: 'Code culture PAC' }),
  codePrecision: z.string().optional().meta({ description: 'Code précision PAC' }),
  geom: z.string().meta({ description: 'Géométrie GeoJSON sérialisée' }),
  culture: z.array(inputApiCultureSchema).meta({ description: 'Cultures (ancien nom de `cultures`)' }),
  cultures: z.array(inputApiCultureSchema).optional().meta({ description: 'Cultures' }),
  enAttentePac: z
    .union([z.boolean(), z.number()])
    .optional()
    .meta({ description: 'Parcelle en attente de la déclaration PAC' })
})

export const inputApiRecordSchema = z.object({
  numeroBio: numberOrString("Numéro bio de l'opérateur"),
  numeroClient: numberOrString("Numéro client de l'opérateur chez l'OC"),
  anneeReferenceControle: z.number().meta({ description: 'Année de référence du contrôle' }),
  anneeAssolement: z.number().meta({ description: "Année de l'assolement" }),
  commentaire: z.string().optional().meta({ description: "Notes de l'audit" }),
  dateAudit: z.string().meta({ description: "Date d'audit" }),
  dateCertificationDebut: z.string().optional().meta({ description: 'Début de validité de la certification' }),
  dateCertificationFin: z.string().optional().meta({ description: 'Fin de validité de la certification' }),
  numeroPacage: numberOrString('Numéro PACAGE'),
  parcelles: z.array(inputApiParcelleSchema).meta({ description: 'Parcelles' })
})

const optionalNumberOrString = z.union([z.number(), z.string()]).nullish()

const optionalYear = z.preprocess((value) => (value === '' ? null : value), z.coerce.number().int().nullish())

export const inputApiCultureBodySchema = z.looseObject({
  codeCPF: z.string().optional(),
  dateSemis: z.string().optional(),
  variete: z.string().optional(),
  quantite: optionalNumberOrString,
  unite: z.enum(['ha', '%']).optional()
})

export const inputApiParcelleBodySchema = z.looseObject({
  id: optionalNumberOrString,
  dateEngagement: z.string().nullish(),
  etatProduction: z.string().nullish(),
  numeroIlot: optionalNumberOrString,
  commune: z.string().nullish(),
  nom: z.string().nullish(),
  numeroParcelle: optionalNumberOrString,
  commentaire: z.string().nullish(),
  codeCulture: z.string().nullish(),
  codePrecision: z.string().nullish(),
  geom: z.string().nullish(),
  culture: z.array(inputApiCultureBodySchema).nullish(),
  cultures: z.array(inputApiCultureBodySchema).nullish(),
  enAttentePac: z.union([z.boolean(), z.number()]).nullish()
})

export const inputApiRecordBodySchema = z
  .looseObject({
    numeroBio: optionalNumberOrString,
    numeroClient: optionalNumberOrString,
    anneeReferenceControle: optionalYear,
    anneeAssolement: optionalYear,
    commentaire: z.string().nullish(),
    dateAudit: z.string().nullish(),
    dateCertificationDebut: z.string().nullish(),
    dateCertificationFin: z.string().nullish(),
    numeroPacage: optionalNumberOrString,
    parcelles: z.array(inputApiParcelleBodySchema)
  })
  .meta({
    description:
      'Un parcellaire (`numeroBio`, `numeroClient`, `dateAudit`, `parcelles`…). Les champs obligatoires sont contrôlés après réception et signalés dans `listeProblemes`.'
  })

export const outputApiCultureSchema = z.looseObject({
  cpf: z
    .string()
    .optional()
    .meta({ description: 'Code CPF de la culture', examples: ['01.19.10.8'] }),
  surface: z.number().nullable().optional().meta({ description: "Surface de la culture, dans l'unité `unite`" }),
  unite: z.enum(['ha', '%']).optional().meta({ description: 'Unité de la surface' }),
  variete: text('Variété'),
  dateSemis: text('Date de semis')
})

export const outputApiFeaturePropertiesSchema = z.looseObject({
  id: z.string().meta({ description: 'Identifiant de la parcelle' }),
  surface: z.number().meta({ description: 'Surface en hectares, calculée en projection légale' }),
  commune: text('Code INSEE de la commune'),
  cultures: z.array(outputApiCultureSchema),
  niveauConversion: z
    .string()
    .nullable()
    .optional()
    .meta({ description: 'Niveau de conversion : `CONV`, `AB?`, `C1`, `C2`, `C3` ou `AB`' }),
  dateEngagement: dateTimeSchema.nullable().optional().meta({ description: "Date d'engagement en bio" }),
  commentaire: text("Notes de l'auditeur sur la parcelle"),
  annotations: z.array(z.unknown()).nullable().optional().meta({ description: "Annotations de l'auditeur" }),
  dateAjout: dateTimeSchema.nullable().optional().meta({ description: 'Date de création de la parcelle' }),
  dateMiseAJour: dateTimeSchema
    .nullable()
    .optional()
    .meta({ description: 'Date de dernière modification de la parcelle' }),
  nom: text('Nom de la parcelle'),
  numeroPacage: textOrNumber('Numéro PACAGE'),
  numeroIlotPAC: textOrNumber("Numéro d'îlot PAC"),
  numeroParcellePAC: textOrNumber('Numéro de parcelle PAC'),
  referenceCadastrale: text('Références cadastrales, séparées par des espaces')
})

export const outputApiParcelleSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: outputGeometrySchema.nullable(),
  properties: outputApiFeaturePropertiesSchema,
  bbox: bboxSchema
})

export const outputApiCertificationSchema = z.looseObject({
  statut: z
    .string()
    .optional()
    .meta({ description: 'État du parcellaire : `OPERATOR_DRAFT`, `AUDITED`, `PENDING_CERTIFICATION` ou `CERTIFIED`' }),
  dateAudit: dateTimeSchema.nullable().optional().meta({ description: "Date d'audit" }),
  dateDebut: dateTimeSchema.nullable().optional().meta({ description: 'Début de validité de la certification' }),
  dateFin: dateTimeSchema.nullable().optional().meta({ description: 'Fin de validité de la certification' }),
  demandesAudit: text("Demandes formulées lors de l'audit"),
  notesAudit: text("Notes de l'audit"),
  anneeReferenceControle: z.number().nullable().optional().meta({ description: 'Année de référence du contrôle' })
})

export const outputApiRecordSchema = z.looseObject({
  numeroBio: z.string().meta({ description: "Numéro bio de l'opérateur", examples: ['99999'] }),
  version_name: z.string().nullable().meta({ description: 'Nom de la version du parcellaire' }),
  certification: outputApiCertificationSchema,
  parcellaire: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(outputApiParcelleSchema),
    bbox: bboxSchema
  })
})

export const paginationLinksSchema = z.object({
  prev: z
    .string()
    .nullable()
    .optional()
    .meta({ description: 'URL de la page précédente, `null` sur la première page' }),
  next: z.string().nullable().optional().meta({ description: 'URL de la page suivante, `null` sur la dernière page' })
})

export const certificationParcellairesResponseSchema = z.object({
  data: z.array(outputApiRecordSchema),
  _links: paginationLinksSchema
})

export const importProblemSchema = z.looseObject({
  numeroBio: z.string().optional().meta({ description: 'Numéro bio du parcellaire concerné' }),
  code: z.string().meta({ description: "Code de l'anomalie" }),
  message: z.string(),
  idParcelle: z
    .union([z.string(), z.number()])
    .optional()
    .meta({ description: 'Identifiant de la parcelle concernée' }),
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
  created: dateTimeSchema.optional().meta({ description: "Date de création, tant que le job n'est pas terminé" }),
  numeroBio: z.string().nullable().optional().meta({ description: 'Numéro bio du premier parcellaire reçu' }),
  numeroClient: z.string().nullable().optional().meta({ description: 'Numéro client du premier parcellaire reçu' }),
  auditDate: dateTimeSchema.nullable().optional().meta({ description: "Date d'audit du premier parcellaire reçu" }),
  result: z.unknown().optional().meta({ description: 'Résultat du job, une fois terminé' }),
  error: z.unknown().optional().meta({ description: "Erreur du job, en cas d'échec" }),
  ended: dateTimeSchema.nullable().optional().meta({ description: 'Date de fin du job' })
})

export const importJobNotFoundResponseSchema = z.object({
  status: z.literal('error'),
  error: z.string().meta({ examples: ["Aucun job n'a cet id"] })
})

export const importSummarySchema = z.looseObject({
  jobId: z.number().optional().meta({ description: 'Identifiant du job' }),
  status: importStatusSchema,
  createdAt: dateTimeSchema.meta({ description: 'Date de réception' }),
  endedAt: dateTimeSchema.nullable().meta({ description: 'Date de fin du traitement' }),
  numeroBio: z.string().nullable().meta({ description: 'Numéro bio du premier parcellaire reçu' }),
  numeroClient: z.string().nullable().meta({ description: 'Numéro client du premier parcellaire reçu' }),
  auditDate: dateTimeSchema.nullable().meta({ description: "Date d'audit du premier parcellaire reçu" }),
  result: z.unknown().meta({ description: 'Résultat du traitement' }),
  payload: z.unknown().meta({ description: 'Corps JSON envoyé (`id`, `payload`), si `withPayload=true`' })
})

export const importListResponseSchema = z.object({
  data: z.array(importSummarySchema),
  meta: z.object({
    total: z.number().meta({ description: "Nombre total d'envois" }),
    page: z.number(),
    limit: z.number()
  }),
  _links: paginationLinksSchema
})

export const importNotFoundResponseSchema = z.object({
  message: z.string().meta({ examples: ['Import introuvable'] })
})

export type OutputApiRecordResponse = z.infer<typeof outputApiRecordSchema>
export type OutputApiRecord = z.infer<typeof outputApiRecordSchema>
export type OutputApiParcelle = z.infer<typeof outputApiParcelleSchema>
export type OutputApiCulture = z.infer<typeof outputApiCultureSchema>
export type InputApiRecord = z.infer<typeof inputApiRecordSchema>
export type InputApiRecordBody = z.infer<typeof inputApiRecordBodySchema>
export type InputApiParcelleBody = z.infer<typeof inputApiParcelleBodySchema>
export type InputApiParcelle = z.infer<typeof inputApiParcelleSchema>
export type InputApiCulture = z.infer<typeof inputApiCultureSchema>
export type ImportReport = z.infer<typeof importReportSchema>
export type ImportJobStatusResponse = z.infer<typeof importJobStatusResponseSchema>
export type ImportSummary = z.infer<typeof importSummarySchema>
