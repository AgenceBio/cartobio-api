import {
  boolean,
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { importLogType, importStatus } from "./enums";

export const parcellairesImport = pgTable("parcellaires_import", {
  id: varchar("id", { length: 64 }).primaryKey(),
  status: importStatus("status").notNull().default("CREATED"),
  organismeCertificateur: varchar("organisme_certificateur", {
    length: 64,
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  numeroBio: varchar("numerobio"),
  numeroClient: varchar("numeroclient"),
  auditDate: timestamp("audit_date", { mode: "date" }),
  resultJob: jsonb("result_job"),
});

export const parcellaireImportLogs = pgTable(
  "parcellaire_import_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: varchar("import_id", { length: 64 })
      .notNull()
      .references(() => parcellairesImport.id, { onDelete: "cascade" }),
    type: importLogType("type").notNull(),
    message: varchar("message").notNull(),
    numeroBio: varchar("numero_bio").notNull(),
    code: varchar("code", { length: 100 }).notNull(),
  },
  (table) => [index("parcellaire_import_logs_import_id_idx").on(table.importId)]
);

export const parcellaireImportPayload = pgTable("parcellaire_import_payload", {
  id: varchar("id").primaryKey(),
  importId: varchar("import_id")
    .notNull()
    .references(() => parcellairesImport.id, { onDelete: "cascade" }),
  payload: jsonb("payload"),
});

export const importPac = pgTable("import_pac", {
  id: uuid("id").primaryKey().defaultRandom(),
  numeroBio: varchar("numerobio"),
  pacage: varchar("pacage"),
  siret: varchar("siret", { length: 14 }),
  nbParcelles: varchar("nb_parcelles", { length: 20 }),
  size: varchar("size"),
  record: jsonb("record"),
  imported: boolean("imported").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
