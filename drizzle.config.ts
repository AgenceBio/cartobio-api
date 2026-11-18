import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  out: './database/drizzle',
  schema: './src/database/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.TARGET_DATABASE_URL ?? ''
  },
  schemaFilter: ['cartobio'],
  migrations: {
    table: 'journal'
  }
})
