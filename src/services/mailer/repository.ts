import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { organismeCertificateur, parcellairesImport } from '../../database/schema/index.js'
import type { DestinataireRapport, StatsOrganisme } from './types.js'

async function getStatsByOrganisme(organisme: string, start: Date, end: Date): Promise<StatsOrganisme | null> {
  const [stats] = await db
    .select({
      organismeCertificateur: parcellairesImport.organismeCertificateur,
      totalRecu: count(),
      totalAcceptes: sql<number>`COUNT(*) FILTER (WHERE ${eq(parcellairesImport.statutJob, 'VALID')})`.mapWith(Number),
      totalRefuses: sql<number>`COUNT(*) FILTER (WHERE ${inArray(parcellairesImport.statutJob, ['REJECTED', 'ERROR'])})`.mapWith(Number)
    })
    .from(parcellairesImport)
    .where(
      and(
        eq(parcellairesImport.organismeCertificateur, organisme),
        gte(parcellairesImport.endedAt, start),
        lte(parcellairesImport.endedAt, end)
      )
    )
    .groupBy(parcellairesImport.organismeCertificateur)

  return stats ?? null
}

async function getDestinatairesRapport(): Promise<DestinataireRapport[]> {
  return db
    .select({
      id: organismeCertificateur.id,
      label: organismeCertificateur.label,
      email: sql<string>`UNNEST(${organismeCertificateur.email})`
    })
    .from(organismeCertificateur)
    .where(eq(organismeCertificateur.active, true))
}

export { getStatsByOrganisme, getDestinatairesRapport }
