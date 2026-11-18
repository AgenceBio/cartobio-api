import { boolean, index, varchar } from 'drizzle-orm/pg-core'
import { cartobio } from './cartobio.js'
import { multiPolygon } from './types.js'

export const territoires = cartobio.table(
  'territoires',
  {
    fid: varchar('fid', { length: 64 }).primaryKey(),
    geometry: multiPolygon('geom').notNull()
  },
  (table) => [index('territoires_geometry_gix').using('gist', table.geometry)]
)

export const regions = cartobio.table(
  'regions',
  {
    code: varchar('code', { length: 10 }).primaryKey(),
    geometry: multiPolygon('geometry').notNull(),
    nom: varchar('nom', { length: 255 }).notNull()
  },
  (table) => [index('regions_geometry_gix').using('gist', table.geometry)]
)

export const communes = cartobio.table(
  'communes',
  {
    fid: varchar('fid', { length: 5 }).primaryKey(),
    geometry: multiPolygon('geometry').notNull(),
    nom: varchar('nom', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true)
  },
  (table) => [index('communes_geometry_gix').using('gist', table.geometry)]
)

export const departements = cartobio.table(
  'departements',
  {
    fid: varchar('fid', { length: 10 }).primaryKey(),
    geometry: multiPolygon('geometry').notNull(),
    nom: varchar('nom', { length: 255 }).notNull(),
    codeRegion: varchar('code_region', { length: 10 })
      .notNull()
      .references(() => regions.code)
  },
  (table) => [index('departements_geometry_gix').using('gist', table.geometry)]
)
