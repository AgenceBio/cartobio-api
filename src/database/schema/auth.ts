import { index, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { cartobio } from "./cartobio.js";

export const revokedTokens = cartobio.table(
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
