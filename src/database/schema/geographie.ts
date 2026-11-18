import {
  boolean,
  geometry,
  index,
  pgTable,
  varchar,
} from 'drizzle-orm/pg-core';

export const territoires = pgTable(
  'territoires',
  {
    fid: varchar('fid', { length: 64 }).primaryKey(),
    geometry: geometry('geom', { srid: 4326 }).notNull(),
  },
  (table) => [index('territoires_geometry_gix').using('gist', table.geometry)],
);

export const regions = pgTable(
  'regions',
  {
    code: varchar('code', { length: 10 }).primaryKey(),
    geometry: geometry('geometry', { srid: 4326 }).notNull(),
    nom: varchar('nom', { length: 255 }).notNull(),
  },
  (table) => [index('regions_geometry_gix').using('gist', table.geometry)],
);

export const communes = pgTable(
  'communes',
  {
    fid: varchar('fid', { length: 5 }).primaryKey(),
    geometry: geometry('geometry', { srid: 4326 }).notNull(),
    nom: varchar('nom', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true),
  },
  (table) => [index('communes_geometry_gix').using('gist', table.geometry)],
);

export const departements = pgTable(
  'departements',
  {
    fid: varchar('fid', { length: 10 }).primaryKey(),
    geometry: geometry('geometry', { srid: 4326 }).notNull(),
    nom: varchar('nom', { length: 255 }).notNull(),
    codeRegion: varchar('code_region', { length: 10 })
      .notNull()
      .references(() => regions.code),
  },
  (table) => [index('departements_geometry_gix').using('gist', table.geometry)],
);
