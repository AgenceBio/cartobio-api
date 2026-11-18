import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'
import { cartobio } from './cartobio.js'
import { importJobEtat, importJobResult, importLogType, importStatus } from './enums.js'

export const parcellaireImport = cartobio.table(
  'parcellaire_import',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    status: importStatus('status').notNull().default('CREATED'),
    organismeCertificateur: integer('organisme_certificateur').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    numeroBio: varchar('numero_bio'),
    numeroClient: varchar('numero_client'),
    auditDate: date('audit_date'),
    resultJob: jsonb('result_job'),
    statutJob: importJobResult('statut_job'),
    etat: importJobEtat('etat').notNull().default('UNKNOWN')
  },
  (table) => [index('parcellaire_import_organisme_created_at_idx').on(table.organismeCertificateur, table.createdAt)]
)

export const parcellaireImportLogs = cartobio.table(
  'parcellaire_import_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: integer('import_id')
      .notNull()
      .references(() => parcellaireImport.id, { onDelete: 'cascade' }),
    type: importLogType('type').notNull(),
    message: varchar('message').notNull(),
    numeroBio: varchar('numero_bio'),
    parcelleId: varchar('parcelle_id'),
    parcelleName: varchar('parcelle_name'),
    code: varchar('code', { length: 100 }).notNull()
  },
  (table) => [index('parcellaire_import_logs_import_id_idx').on(table.importId)]
)

export const parcellaireImportPayload = cartobio.table(
  'parcellaire_import_payload',
  {
    id: varchar('id').primaryKey(),
    importId: integer('import_id')
      .notNull()
      .references(() => parcellaireImport.id, { onDelete: 'cascade' }),
    payload: jsonb('payload')
  },
  (table) => [index('parcellaire_import_payload_import_id_idx').on(table.importId)]
)

export const importPac = cartobio.table(
  'import_pac',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numeroBio: varchar('numero_bio'),
    pacage: varchar('pacage'),
    siret: varchar('siret', { length: 14 }),
    nbParcelles: integer('nb_parcelles'),
    size: numeric('size', { mode: 'number' }),
    record: jsonb('record'),
    imported: boolean('imported').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`)
  },
  (table) => [uniqueIndex('import_pac_numero_bio_pacage_siret_idx').on(table.numeroBio, table.pacage, table.siret)]
)
