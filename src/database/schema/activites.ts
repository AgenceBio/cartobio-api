import {
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { cartobio } from "./cartobio.js";
import { parcellaires } from './parcellaires.js';
import { parcelles } from './parcelles.js';
import { productionAttestationStatus, productionAttestationType } from './enums.js';

export const attestationsProduction = cartobio.table(
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
    uniqueIndex('attestations_production_record_id_type_idx').on(table.recordId, table.type),
  ],
);

export const parcellairesConsultes = cartobio.table(
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

export const parcellairesEpingles = cartobio.table(
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

export const parcellesControles = cartobio.table(
  'parcelles_controles',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: 'cascade' }),
    parcelleId: text('parcelle_id').notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.recordId, table.parcelleId, table.userId] }),
    foreignKey({
      name: 'parcelles_controles_parcelle_fkey',
      columns: [table.recordId, table.parcelleId],
      foreignColumns: [parcelles.recordId, parcelles.id],
    }).onDelete('cascade'),
  ],
);
