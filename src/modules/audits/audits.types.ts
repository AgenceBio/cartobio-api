import type { SQL } from 'drizzle-orm'
import type { RecordInfosBody } from '@agencebio/cartobio-types'

export type AuditRecordChanges = Omit<RecordInfosBody, 'audit_date' | 'mixite'> & {
  updated_at: SQL
  audit_date?: RecordInfosBody['audit_date'] | SQL
  mixite?: string | null
  oc_id?: number
  oc_label?: string | null
}
