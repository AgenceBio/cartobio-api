import 'dotenv/config'
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { db } from '../src/database/database.js'
import { parcellaireImport, parcellaireImportPayload } from '../src/database/schema/index.js'
import { importJobResultEnumSchema, importStatusEnumSchema, updateImportJobSchema } from '../src/database/validations/imports.js'

async function clearPayloads (status: typeof parcellaireImport.$inferSelect.status, olderThan: string): Promise<number | null> {
  const { rowCount } = await db
    .update(parcellaireImportPayload)
    .set({ payload: null })
    .where(and(
      isNotNull(parcellaireImportPayload.payload),
      inArray(
        parcellaireImportPayload.importId,
        db
          .select({ id: parcellaireImport.id })
          .from(parcellaireImport)
          .where(and(
            eq(parcellaireImport.status, status),
            lt(parcellaireImport.endedAt, sql`now() - ${olderThan}::interval`)
          ))
      )
    ))

  return rowCount
}

async function failStuckJobs (): Promise<number | null> {
  const { rowCount } = await db
    .update(parcellaireImport)
    .set({
      ...updateImportJobSchema.parse({
        status: importStatusEnumSchema.enum.ERROR,
        statutJob: importJobResultEnumSchema.enum.ERROR,
        resultJob: { name: 'Error', message: 'Traitement du job interrompu' }
      }),
      endedAt: sql`NOW()`
    })
    .where(and(
      eq(parcellaireImport.status, importStatusEnumSchema.enum.PENDING),
      lt(parcellaireImport.createdAt, sql`now() - interval '1 hour'`)
    ))

  return rowCount
}

async function cleanupJobsImportPayload (): Promise<{ stuck: number | null, done: number | null, error: number | null }> {
  try {
    const stuckCount = await failStuckJobs()
    const doneCount = await clearPayloads(importStatusEnumSchema.enum.DONE, '15 days')
    const errorCount = await clearPayloads(importStatusEnumSchema.enum.ERROR, '3 months')

    return { stuck: stuckCount, done: doneCount, error: errorCount }
  } catch (err) {
    console.error('Erreur lors du nettoyage de jobs_import :', err)
    throw err
  }
}

cleanupJobsImportPayload()
  .then(res => {
    console.log('Nettoyage terminé avec succès.', res)
    process.exit(0)
  })
  .catch(err => {
    console.error('Echec du nettoyage :', err)
    process.exit(1)
  })
