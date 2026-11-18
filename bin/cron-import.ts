import 'dotenv/config'
import { and, eq, inArray, isNotNull, lt, ne, or, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../src/database/database.js'
import { parcellaireImport, parcellaireImportPayload } from '../src/database/schema/index.js'
import { importJobResultEnumSchema, updateImportPayloadSchema } from '../src/database/validations/imports.js'
import { failInterruptedImportJobs } from '../src/modules/imports/imports.repository.js'

async function clearPayloads(condition: SQL | undefined, olderThan: string): Promise<number | null> {
  const { rowCount } = await db
    .update(parcellaireImportPayload)
    .set(updateImportPayloadSchema.parse({ payload: null }))
    .where(
      and(
        isNotNull(parcellaireImportPayload.payload),
        inArray(
          parcellaireImportPayload.importId,
          db
            .select({ id: parcellaireImport.id })
            .from(parcellaireImport)
            .where(
              and(
                isNotNull(parcellaireImport.endedAt),
                condition,
                lt(parcellaireImport.endedAt, sql`now() - ${olderThan}::interval`)
              )
            )
        )
      )
    )

  return rowCount
}

async function cleanupJobsImportPayload(): Promise<{
  stuck: number
  valid: number | null
  refused: number | null
}> {
  try {
    const stuckCount = await failInterruptedImportJobs()
    const valid = eq(parcellaireImport.statutJob, importJobResultEnumSchema.enum.VALID)
    const validCount = await clearPayloads(valid, '7 days')
    const refusedCount = await clearPayloads(
      or(isNull(parcellaireImport.statutJob), ne(parcellaireImport.statutJob, importJobResultEnumSchema.enum.VALID)),
      '3 months'
    )

    return { stuck: stuckCount, valid: validCount, refused: refusedCount }
  } catch (err) {
    console.error('Erreur lors du nettoyage de jobs_import :', err)
    throw err
  }
}

cleanupJobsImportPayload()
  .then((res) => {
    console.log('Nettoyage terminé avec succès.', res)
    process.exit(0)
  })
  .catch((err) => {
    console.error('Echec du nettoyage :', err)
    process.exit(1)
  })
