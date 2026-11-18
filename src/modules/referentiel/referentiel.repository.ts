import { eq } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { departements, regions } from '../../database/schema/index.js'
import type { DepartementRow } from './referentiel.types.js'

export async function findDepartements(): Promise<DepartementRow[]> {
  const rows = await db
    .select({ nomRegion: regions.nom, code: departements.fid, nom: departements.nom })
    .from(departements)
    .leftJoin(regions, eq(departements.codeRegion, regions.code))

  return rows.map((row) => ({ ...row, nomRegion: row.code.length === 3 ? 'DOM-TOM' : (row.nomRegion ?? '') }))
}
