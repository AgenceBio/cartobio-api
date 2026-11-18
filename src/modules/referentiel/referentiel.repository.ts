import { eq, sql } from 'drizzle-orm'
import { db } from '../../database/database.js'
import { departements, regions } from '../../database/schema/index.js'
import type { DepartementRow } from './referentiel.types.js'

async function findDepartements(): Promise<DepartementRow[]> {
  return db
    .select({
      nomRegion: sql<string>`CASE WHEN LENGTH(${departements.fid}) = 3 THEN 'DOM-TOM' ELSE ${regions.nom} END`,
      code: departements.fid,
      nom: departements.nom
    })
    .from(departements)
    .leftJoin(regions, eq(departements.codeRegion, regions.code))
}

export { findDepartements }
