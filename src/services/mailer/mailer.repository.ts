import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { organismeCertificateur, parcellaireImport } from '../../database/schema/index.js'
import { importJobResultEnumSchema } from '../../database/validations/imports.js'
import type { DestinataireRapport, StatsOrganisme } from './mailer.types.js'

export async function findStatsByOrganisme(organisme: number, start: Date, end: Date): Promise<StatsOrganisme | null> {
  const [stats] = await db
    .select({
      organismeCertificateur: parcellaireImport.organismeCertificateur,
      totalRecu: count(),
      totalAcceptes:
        sql<number>`COUNT(*) FILTER (WHERE ${eq(parcellaireImport.statutJob, importJobResultEnumSchema.enum.VALID)})`.mapWith(
          Number
        ),
      totalRefuses:
        sql<number>`COUNT(*) FILTER (WHERE ${inArray(parcellaireImport.statutJob, [importJobResultEnumSchema.enum.REJECTED, importJobResultEnumSchema.enum.ERROR])})`.mapWith(
          Number
        )
    })
    .from(parcellaireImport)
    .where(
      and(
        eq(parcellaireImport.organismeCertificateur, organisme),
        gte(parcellaireImport.endedAt, start),
        lte(parcellaireImport.endedAt, end)
      )
    )
    .groupBy(parcellaireImport.organismeCertificateur)

  return stats ?? null
}

export async function findDestinatairesRapport(): Promise<DestinataireRapport[]> {
  return db
    .select({
      id: organismeCertificateur.id,
      label: organismeCertificateur.label,
      email: sql<string>`UNNEST(${organismeCertificateur.email})`
    })
    .from(organismeCertificateur)
    .where(eq(organismeCertificateur.active, true))
}
