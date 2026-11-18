import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { toIsoDate } from '@agencebio/cartobio-types'
import type { IsoDate } from '@agencebio/cartobio-types'
import { parcelles } from '../../database/schema/index.js'
import type { ConversionNiveau } from '../../database/validations/parcelles.js'

export function sansDateParDefaut(date: string | null): IsoDate | null {
  return date === null || date === '1970-01-01' ? null : toIsoDate(date)
}

export function surfaceHa(niveau?: ConversionNiveau): SQL<number> {
  const filtre = niveau ? sql` FILTER (WHERE ${eq(parcelles.conversionNiveau, niveau)})` : sql``
  return sql`ROUND(COALESCE(SUM(${parcelles.surfaceHa})${filtre}, 0), 2)`.mapWith(Number)
}
