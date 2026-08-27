import {
  boolean,
  date,
  geometry,
  index,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { conversionNiveau, annotationType, statutImportGeom } from "./enums";
import { parcellaires } from "./parcellaires";
import { communes } from "./geographie";

export const parcelles = pgTable(
  "parcelles",
  {
    id: text("id"),
    recordId: uuid("record_id")
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: "cascade" }),
    commune: varchar("commune", { length: 5 }).references(() => communes.fid),
    geometry: geometry("geometry", { srid: 4326 }).notNull(),
    surfaceHa: numeric("surface_ha", { precision: 12, scale: 4 }).notNull(),
    conversionNiveau: conversionNiveau("conversion_niveau"),
    engagementDate: date("engagement_date"),
    commentaireOperateur: text("commentaire_operateur"),
    auditeurNotesParcelles: text("auditeur_notes_parcelles"),
    fromParcelles: text("from_parcelles").array(),
    name: text("name"),
    numeroPacage: smallint("numero_pacage"),
    numeroIlotPac: smallint("numero_ilot_pac"),
    numeroParcellesPac: smallint("numero_parcelles_pac"),
    referenceCadastre: text("reference_cadastre").array(),
    codeCulturePac: varchar("code_culture_pac"),
    codePrecisionPac: varchar("code_precision_pac"),
    etranger: boolean("etranger").notNull().default(false),
    statutImportGeom: statutImportGeom("statut_import_geom"),
    attentePac: boolean("attente_pac").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.recordId, table.id] }),
    index("parcelles_record_id_idx").on(table.recordId),
    index("parcelles_commune_idx").on(table.commune),
    index("parcelles_geometry_gix").using("gist", table.geometry),
  ]
);

export const parcelleCultures = pgTable(
  "parcelle_cultures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: "cascade" }),
    parcelleId: text("parcelle_id")
      .notNull()
      .references(() => parcelles.id, { onDelete: "cascade" }),
    cpf: varchar("cpf", { length: 64 }).notNull(),
    codeCultureImport: varchar("code_culture_import", { length: 64 }),
    surface: numeric("surface", { precision: 12, scale: 4 }),
    unit: varchar("unit", { length: 20 }),
    variete: varchar("variete", { length: 255 }),
    dateSemis: date("date_semis"),
  },
  (table) => [
    index("parcelle_cultures_record_id_idx").on(table.recordId),
    index("parcelle_cultures_parcelle_id_idx").on(table.parcelleId),
    index("parcelle_cultures_cpf_idx").on(table.cpf),
  ]
);

export const parcellesAnnotations = pgTable(
  "parcelles_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parcelleId: text("parcelle_id")
      .notNull()
      .references(() => parcelles.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: "cascade" }),
    typeAnnot: annotationType("type_annot").notNull(),
    createdAt: date("created_at").notNull(),
  },
  (table) => [
    index("parcelles_annotations_parcelle_id_idx").on(table.parcelleId),
    index("parcelles_annotations_record_id_idx").on(table.recordId),
  ]
);
