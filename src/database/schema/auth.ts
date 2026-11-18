import { index, integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { cartobio } from './cartobio.js'

export const sessions = cartobio.table(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id').notNull(),
    tokenHash: varchar('token_hash').notNull().unique(),
    previousTokenHash: varchar('previous_token_hash').unique(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
    idToken: text('id_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
  },
  (table) => [index('sessions_user_id_idx').on(table.userId), index('sessions_expires_at_idx').on(table.expiresAt)]
)
