import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod';
import { z } from 'zod';
import { parcelles, parcelleCultures } from '../db/schema/parcelles';
import { emptyToNull, isoDate } from './helpers';

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
