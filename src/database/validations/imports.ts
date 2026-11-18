import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod'
import { z } from 'zod'
import { ImportLogCode } from '@agencebio/cartobio-types'
import { importJobEtat, importJobResult, importStatus } from '../schema/enums.js'
import { importPac, parcellaireImportLogs, parcellaireImportPayload, parcellaireImport } from '../schema/imports.js'
import { emptyToNull, isoDate } from './helpers.js'

export const importStatusEnumSchema = z.enum(importStatus.enumValues)

export const importJobResultEnumSchema = z.enum(importJobResult.enumValues)

export const importJobEtatEnumSchema = z.enum(importJobEtat.enumValues)

export type ImportStatus = z.infer<typeof importStatusEnumSchema>

export type ImportJobResult = z.infer<typeof importJobResultEnumSchema>

export type ImportJobEtat = z.infer<typeof importJobEtatEnumSchema>

export const createImportJobSchema = createInsertSchema(parcellaireImport, {
  organismeCertificateur: (schema) => schema.trim().min(1)
})
  .pick({
    status: true,
    organismeCertificateur: true
  })
  .strict()

export const updateImportJobSchema = createUpdateSchema(parcellaireImport, {
  numeroBio: () => emptyToNull(z.string().trim()),
  numeroClient: () => emptyToNull(z.string().trim()),
  auditDate: () => isoDate
})
  .omit({
    id: true,
    organismeCertificateur: true,
    createdAt: true,
    startedAt: true,
    endedAt: true
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Au moins un champ doit être fourni.'
  })

export const createImportLogSchema = createInsertSchema(parcellaireImportLogs, {
  importId: (schema) => schema.int().positive(),
  code: () => z.enum(ImportLogCode)
})
  .omit({
    id: true
  })
  .strict()

export const createImportPayloadSchema = createInsertSchema(parcellaireImportPayload, {
  id: () => z.uuid(),
  importId: (schema) => schema.int().positive()
}).strict()

export const updateImportPayloadSchema = createUpdateSchema(parcellaireImportPayload)
  .pick({
    payload: true
  })
  .strict()

export const createImportPacSchema = createInsertSchema(importPac)
  .pick({
    numeroBio: true,
    nbParcelles: true,
    size: true,
    record: true,
    pacage: true,
    siret: true
  })
  .strict()

export const updateImportPacSchema = createUpdateSchema(importPac)
  .pick({
    imported: true
  })
  .strict()
