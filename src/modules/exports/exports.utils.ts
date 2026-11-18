import { eq, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import { parcelles } from '../../database/schema/index.js'
import type { ConversionNiveau } from './exports.types.js'

export function sansDateParDefaut (date: SQLWrapper): SQL<string | null> {
  return sql<string | null>`NULLIF(${date}, '1970-01-01')`
}

export function surfaceHa (niveau?: ConversionNiveau): SQL<number> {
  const filtre = niveau ? sql` FILTER (WHERE ${eq(parcelles.conversionNiveau, niveau)})` : sql``
  return sql`ROUND(COALESCE(SUM(${parcelles.surfaceHa})${filtre}, 0), 2)`.mapWith(Number)
}
