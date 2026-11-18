import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const revokedTokens = pgTable(
  "revoked_tokens",
  {
    tokenHash: varchar("token_hash").primaryKey(),
    userId: text("user_id"),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [index("revoked_tokens_expires_at_idx").on(table.expiresAt)]
);
