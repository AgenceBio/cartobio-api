import type { RecordInfosBody } from '@agencebio/cartobio-types'

export type AuditRecordChanges = Omit<RecordInfosBody, 'mixite'> & {
  updated_at: Date
  mixite?: string | null
  oc_id?: number
  oc_label?: string | null
}
