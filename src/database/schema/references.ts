import { boolean, integer, text } from 'drizzle-orm/pg-core'
import { cartobio } from './cartobio.js'

export const organismeCertificateur = cartobio.table('organisme_certificateur', {
  id: integer('id').primaryKey(),
  label: text('label').notNull(),
  email: text('email').array(),
  active: boolean('active').notNull().default(true)
})
