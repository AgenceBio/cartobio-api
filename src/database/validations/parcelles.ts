import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod';
import { z } from 'zod';
import { annotationType, conversionNiveau } from '../schema/enums.js';
import { parcelles, parcelleCultures } from '../schema/parcelles.js';
import { emptyToNull, isoDate } from './helpers.js';

export const annotationTypeEnumSchema = z.enum(annotationType.enumValues);

export type AnnotationType = z.infer<typeof annotationTypeEnumSchema>;

export const conversionNiveauEnumSchema = z.enum(conversionNiveau.enumValues);

export type ConversionNiveau = z.infer<typeof conversionNiveauEnumSchema>;

export const annotationCodes: Record<string, AnnotationType> = {
  downgraded: annotationTypeEnumSchema.enum.DOWNGRADED,
  state: annotationTypeEnumSchema.enum.METADATA_STATE,
  'reduction-conversion': annotationTypeEnumSchema.enum.REDUCED_CONVERSION_PERIOD,
  risky: annotationTypeEnumSchema.enum.RISKY,
  sampled: annotationTypeEnumSchema.enum.SAMPLED,
  surveyed: annotationTypeEnumSchema.enum.SURVEYED,
};

export const createParcelleSchema = createInsertSchema(parcelles, {
  id: (schema) => schema.min(1).max(255),
  surfaceHa: () => z.coerce.number().positive().max(1_000_000),
  engagementDate: () => isoDate,
  commentaireOperateur: () => emptyToNull(z.string().trim().max(10_000)),
  auditeurNotesParcelles: () => emptyToNull(z.string().trim().max(10_000)),
  name: () => emptyToNull(z.string().trim().max(255)),
})
  .omit({
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .strict();

export const updateParcelleSchema = createUpdateSchema(parcelles, {
  surfaceHa: () => z.coerce.number().positive().max(1_000_000),
  engagementDate: () => isoDate,
  numeroIlotPac: () => emptyToNull(z.number()),
  numeroParcellesPac: () => emptyToNull(z.number()),
})
  .omit({
    id: true,
    recordId: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Au moins un champ est requis.',
  });

export const createParcelleCultureSchema = createInsertSchema(parcelleCultures, {
  cpf: (schema) => schema.trim().min(1).max(64),
  surface: () => emptyToNull(z.coerce.number().positive()),
  dateSemis: () => isoDate,
  unit: () => emptyToNull(z.string().trim().max(20)),
  variete: () => emptyToNull(z.string().trim().max(255)),
})
  .omit({ id: true })
  .strict();
