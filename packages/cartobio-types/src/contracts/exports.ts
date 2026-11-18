import { z } from 'zod'
import { booleanQuery, opt, text, textOrNumber } from './helpers.js'
import { dateTimeSchema } from './common.js'
import { operatorFilterSchema } from './operators.js'

export const exportPdfParamsSchema = z.object({
  numeroBio: z.string().meta({ description: 'Numéro bio de l\'opérateur' }),
  recordId: z.string().meta({ description: 'Identifiant du parcellaire (record_id)' })
})

export const exportPdfQuerySchema = z.object({
  force_refresh: booleanQuery('Régénère l\'attestation même si une version valide existe'),
  pac: booleanQuery('Attestation limitée aux parcelles PAC, numéros d\'îlot et de parcelle'),
  zip: booleanQuery('Archive zip des attestations PAC détaillée et complète')
})

export const exportParcellaireBodySchema = z.object({
  payload: z.object({
    input: z.string().meta({ description: 'Texte recherché, comme pour la recherche d\'opérateurs' }),
    filterForSearch: operatorFilterSchema
  })
})

export const exportParcellaireRowSchema = z.looseObject({
  record_id: z.string().meta({ description: 'Identifiant du parcellaire' }),
  numerobio: textOrNumber('Numéro bio'),
  numeroclient: text('Numéro client chez l\'OC'),
  siret: text('SIRET'),
  raisonSociale: text('Raison sociale'),
  codePostal: text('Code postal'),
  commune: text('Commune'),
  version_name: text('Nom de la version'),
  source: text('Source de l\'import'),
  provenance: text('Provenance de l\'import'),
  campagne: text('Campagne'),
  certification_state: text('État du parcellaire'),
  mixite: text('Mixité : `AB`, `ABCONV` ou `MIXTE`'),
  anneereference: opt(z.number(), 'Année de référence du contrôle'),
  audit_date: opt(dateTimeSchema, 'Date d\'audit'),
  audit_notes: text('Notes de l\'audit'),
  certification_date_debut: opt(dateTimeSchema, 'Début de validité de la certification'),
  certification_date_fin: opt(dateTimeSchema, 'Fin de validité de la certification'),
  created_at: opt(dateTimeSchema, 'Date de création'),
  updated_at: opt(dateTimeSchema, 'Date de dernière modification'),
  nombre_parcelles: textOrNumber('Nombre de parcelles'),
  superficie_totale_ha: textOrNumber('Surface totale (ha)'),
  surface_conventionnel_ha: textOrNumber('Surface en conventionnel (ha)'),
  surface_c1_ha: textOrNumber('Surface en C1 (ha)'),
  surface_c2_ha: textOrNumber('Surface en C2 (ha)'),
  surface_c3_ha: textOrNumber('Surface en C3 (ha)'),
  surface_ab_ha: textOrNumber('Surface en AB (ha)')
})

export const exportParcellaireResponseSchema = z.array(exportParcellaireRowSchema)

export const exportPdfResponseSchema = z.string().meta({ description: 'PDF, ou archive zip avec `zip=true`, encodé en base64' })

export const exportPdfErrorResponseSchema = z.object({
  message: z.string().meta({ description: 'Raison de l\'échec de la génération' })
})

export type ExportPdfParams = z.infer<typeof exportPdfParamsSchema>
export type ExportPdfQuery = z.infer<typeof exportPdfQuerySchema>
export type ExportParcellaireBody = z.infer<typeof exportParcellaireBodySchema>
export type ExportParcellaireResponse = z.infer<typeof exportParcellaireResponseSchema>
