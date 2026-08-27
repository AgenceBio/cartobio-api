import { boolean, pgTable, text, varchar } from "drizzle-orm/pg-core";

export const organismeCertificateur = pgTable("organisme_certificateur", {
  id: varchar("id", { length: 64 }).primaryKey(),
  label: text("label").notNull(),
  email: text("email").array(),
  active: boolean("active").notNull().default(true),
});