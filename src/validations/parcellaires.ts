import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod';
import { z } from 'zod';
import { parcellaires } from '../db/schema/parcellaires';

const emptyStringToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullable());

export const createParcellaireSchema = createInsertSchema(parcellaires, {
  numeroBio: (schema) => schema.int().positive(),
  anneeReferenceControle: (schema) => schema.int().min(2020).max(2100),
  versionNom: (schema) => schema.trim().min(1).max(255),
  auditNotesCertif: () => emptyStringToNull(z.string().trim().max(10_000)),
  auditDemandesOperateur: () => emptyStringToNull(z.string().trim().max(10_000)),
})
  .omit({
    recordId: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .strict();

export const updateParcellaireSchema = createUpdateSchema(parcellaires, {
  numeroBio: (schema) => schema.int().positive(),
  auditNotesCertif: () => emptyStringToNull(z.string().trim().max(10_000)),
  auditDemandesOperateur: () => emptyStringToNull(z.string().trim().max(10_000)),
})
  .omit({
    recordId: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Au moins un champ doit être fourni.',
  });

export type CreateParcellaireInput = z.infer<typeof createParcellaireSchema>;
export type UpdateParcellaireInput = z.infer<typeof updateParcellaireSchema>;
