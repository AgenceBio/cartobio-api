import * as cartobio from '../../../shared/parcellaires/parcellaires.service.js'
import { NotFoundApiError } from '../../../shared/errors.js'
import { normalizeRecord } from '../../../shared/outputs/record.js'
import type { NormalizedRecord } from '@agencebio/cartobio-types'
import * as repository from '../imports.repository.js'
import type { OperatorRecordFilters } from '../imports.types.js'

async function getOperatorLastRecord (numeroBio: string | number, { anneeAudit = null, statut = null }: OperatorRecordFilters = {}) {
  const record = await repository.findLastOperatorRecord(numeroBio, { anneeAudit, statut })

  if (!record) {
    throw new NotFoundApiError('Aucun parcellaire trouvé')
  }

  return normalizeRecord(await cartobio.joinRecordParcelles(record))
}

/**
 * @param options.anneeAudit Filtre par année d'audit
 * @param options.statut Filtre par statut de certification
 * @param options.anneeReferenceControle Filtre par anneeReferenceControle
 * @param options.limit Taille de page
 * @param options.start Décalage (OFFSET)
 */
async function iterateOperatorLastRecords (
  ocId: number,
  { anneeAudit = null, statut = null, anneeReferenceControle = null, limit = null, start = null }: OperatorRecordFilters = {}
): Promise<NormalizedRecord[]> {
  const rows = await repository.findOperatorLastRecords(ocId, { anneeAudit, statut, anneeReferenceControle, limit, start })

  return Promise.all(rows.map(async row => normalizeRecord(await cartobio.joinRecordParcelles(row))))
}

export { getOperatorLastRecord, iterateOperatorLastRecords }
