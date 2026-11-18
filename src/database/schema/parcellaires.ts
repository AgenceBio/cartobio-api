import {
  date,
  index,
  integer,
  smallint,
  text,
  varchar,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cartobio } from "./cartobio.js";
import { certificationType, mixiteType, parcellaireEventType } from './enums.js';
import { organismeCertificateur } from './references.js';

export const parcellaires = cartobio.table(
  'parcellaires',
  {
    recordId: uuid('record_id').primaryKey().defaultRandom(),
    numeroBio: integer('numerobio').notNull(),
    ocId: varchar('oc_id', { length: 64 }).references(() => organismeCertificateur.id),
    certificationEtat: certificationType('certification_etat').notNull(),
    certificationDateDebut: date('certification_date_debut'),
    certificationDateFin: date('certification_date_fin'),
    auditDate: date('audit_date'),
    anneeReferenceControle: smallint('annee_reference_controle').notNull(),
    auditNotesCertif: text('audit_notes_certif'),
    auditDemandesOperateur: text('audit_demandes_operateur'),
    versionNom: text('version_nom').notNull(),
    mixite: mixiteType('mixite'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    dateDerniereNotif: timestamp('date_derniere_notif', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('parcellaires_numerobio_idx').on(table.numeroBio),
    index('parcellaires_oc_id_idx').on(table.ocId),
  ],
);

export const parcellairesMetadata = cartobio.table('parcellaires_metadata', {
  recordId: uuid('record_id')
    .primaryKey()
    .references(() => parcellaires.recordId, { onDelete: 'cascade' }),
  source: text('source'),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
  provenance: text('provenance'),
  campagne: smallint('campagne'),
  numeroPacage: text('numero_pacage'),
  anneeAssolement: smallint('annee_assolement'),
});

export const parcellairesEvenements = cartobio.table(
  'parcellaires_evenements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => parcellaires.recordId, { onDelete: 'cascade' }),
    type: parcellaireEventType('type').notNull(),
    certificationEtat: certificationType('certification_etat').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    userId: varchar('user_id', { length: 255 }),
    userRole: text('user_role'),
    parcellesId: text('parcelles_id').array(),
  },
  (table) => [index('parcellaires_evenements_record_id_idx').on(table.recordId)],
);
