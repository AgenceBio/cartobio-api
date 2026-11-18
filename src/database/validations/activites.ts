import { createInsertSchema } from 'drizzle-orm/zod';
import { z } from 'zod';
import { operateursConsultes, operateursEpingles } from '../schema/activites.js';

export const createOperateurEpingleSchema = createInsertSchema(operateursEpingles, {
  numeroBio: (schema) => schema.int().positive(),
  userId: (schema) => schema.trim().min(1),
})
  .pick({
    numeroBio: true,
    userId: true,
  })
  .strict();

export const createOperateurConsulteSchema = createInsertSchema(operateursConsultes, {
  numeroBio: (schema) => schema.int().positive(),
  userId: (schema) => schema.trim().min(1),
})
  .pick({
    numeroBio: true,
    userId: true,
  })
  .strict();

export type CreateOperateurEpingleInput = z.infer<typeof createOperateurEpingleSchema>;
export type CreateOperateurConsulteInput = z.infer<typeof createOperateurConsulteSchema>;
