#!/usr/bin/env node

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

try {
  const stuck = await failInterruptedImportJobs()
  const valid = await clearPayloads(eq(parcellaireImport.statutJob, importJobResultEnumSchema.enum.VALID), '15 days')
  const refused = await clearPayloads(
    or(isNull(parcellaireImport.statutJob), ne(parcellaireImport.statutJob, importJobResultEnumSchema.enum.VALID)),
    '3 months'
  )
  console.log('Nettoyage terminé avec succès.', { stuck, valid, refused })
} finally {
  await db.$client.end()
}
