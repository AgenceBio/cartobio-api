import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { parcellairesMetadata } from '../../database/schema/index.js'

export const recordMetadata: SQL<Record<string, unknown>> = sql<Record<string, unknown>>`jsonb_strip_nulls(jsonb_build_object(
  'source', ${parcellairesMetadata.source},
  'sourceLastUpdate', ${parcellairesMetadata.sourceUpdatedAt},
  'provenance', ${parcellairesMetadata.provenance},
  'campagne', ${parcellairesMetadata.campagne}::text,
  'pacage', ${parcellairesMetadata.numeroPacage},
  'anneeAssolement', ${parcellairesMetadata.anneeAssolement}::text
))`
