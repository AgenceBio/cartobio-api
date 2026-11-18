import * as cartobio from '../../../shared/parcellaires/parcellaires.service.js'
import { NotFoundApiError } from '../../../shared/errors.js'
import { normalizeRecord } from '../../../shared/outputs/record.js'
import type { NormalizedRecord } from '@agencebio/cartobio-types'
import * as repository from '../imports.repository.js'
import type { OperatorRecordFilters } from '../imports.types.js'
import { chunk } from '../../../shared/parcellaires/parcellaires.utils.js'

const JOIN_CONCURRENCY = 5

async function getOperatorLastRecord(
  numeroBio: string | number,
  { anneeAudit = null, statut = null }: OperatorRecordFilters = {}
): Promise<NormalizedRecord> {
  const record = await repository.findLastOperatorRecord(numeroBio, { anneeAudit, statut })

  if (!record) {
    throw new NotFoundApiError('Aucun parcellaire trouvé')
  }

  return normalizeRecord(await cartobio.joinRecordParcelles(record))
}

async function iterateOperatorLastRecords(
  ocId: number,
  {
    anneeAudit = null,
    statut = null,
    anneeReferenceControle = null,
    limit = null,
    start = null
  }: OperatorRecordFilters = {}
): Promise<NormalizedRecord[]> {
  const rows = await repository.findOperatorLastRecords(ocId, {
    anneeAudit,
    statut,
    anneeReferenceControle,
    limit,
    start
  })

  const records: NormalizedRecord[] = []
  for (const batch of chunk(rows, JOIN_CONCURRENCY)) {
    records.push(
      ...(await Promise.all(batch.map(async (row) => normalizeRecord(await cartobio.joinRecordParcelles(row)))))
    )
  }
  return records
}

export { getOperatorLastRecord, iterateOperatorLastRecords }
