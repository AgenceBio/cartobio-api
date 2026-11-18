import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod';
import { z } from 'zod';
import { annotationType, conversionNiveau } from '../schema/enums.js';
import { parcelles, parcelleCultures, parcellesAnnotations } from '../schema/parcelles.js';
import { emptyToNull, isoDate } from './helpers.js';

export const annotationTypeEnumSchema = z.enum(annotationType.enumValues);

export type AnnotationType = z.infer<typeof annotationTypeEnumSchema>;

export const conversionNiveauEnumSchema = z.enum(conversionNiveau.enumValues);

export type ConversionNiveau = z.infer<typeof conversionNiveauEnumSchema>;

export const annotationCodes = {
  downgraded: annotationTypeEnumSchema.enum.DOWNGRADED,
  state: annotationTypeEnumSchema.enum.METADATA_STATE,
  'reduction-conversion': annotationTypeEnumSchema.enum.REDUCED_CONVERSION_PERIOD,
  risky: annotationTypeEnumSchema.enum.RISKY,
  sampled: annotationTypeEnumSchema.enum.SAMPLED,
  surveyed: annotationTypeEnumSchema.enum.SURVEYED,
} as const satisfies Record<string, AnnotationType>;

export type AnnotationCode = keyof typeof annotationCodes;

export const isAnnotationCode = (code: string): code is AnnotationCode => Object.hasOwn(annotationCodes, code);

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

export const createParcelleAttributesSchema = createParcelleSchema.pick({
  recordId: true,
  id: true,
  commentaireOperateur: true,
  auditeurNotesParcelles: true,
  name: true,
  numeroPacage: true,
  codeCulturePac: true,
  codePrecisionPac: true,
  fromParcelles: true,
});

export const updateParcelleSchema = createUpdateSchema(parcelles, {
  surfaceHa: () => z.coerce.number().positive().max(1_000_000),
  engagementDate: () => isoDate,
  numeroIlotPac: () => emptyToNull(z.coerce.number().int().min(-32768).max(32767)),
  numeroParcellesPac: () => emptyToNull(z.coerce.number().int().min(-32768).max(32767)),
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
  id: (schema) => schema.trim().min(1),
  cpf: (schema) => schema.trim().min(1).max(64),
  dateSemis: () => isoDate,
  unit: () => emptyToNull(z.string().trim().max(20)),
  variete: () => emptyToNull(z.string().trim().max(255)),
}).strict();

export const createParcelleAnnotationSchema = createInsertSchema(parcellesAnnotations, {
  id: z.uuid(),
}).strict();
