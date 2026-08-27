import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { parcellaires } from './parcellaires';
import { parcelles } from './parcelles';
import { productionAttestationStatus, productionAttestationType } from './enums';

export const attestationsProduction = pgTable(
  'attestations_production',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: 'cascade' }),
    path: varchar('path', { length: 1_024 }),
    status: productionAttestationStatus('status').notNull(),
    type: productionAttestationType('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('attestations_production_record_id_idx').on(table.recordId),
  ],
);

export const parcellairesConsultes = pgTable(
  'parcellaires_consultes',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.recordId, table.userId] })],
);

export const parcellairesEpingles = pgTable(
  'parcellaires_epingles',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.recordId, table.userId] })],
);

export const parcellesControles = pgTable(
  'parcelles_controles',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: 'cascade' }),
    parcelleId: text('parcelle_id')
      .notNull()
      .references(() => parcelles.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.recordId, table.parcelleId, table.userId] }),
  ],
);
