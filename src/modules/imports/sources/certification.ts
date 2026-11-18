import * as cartobio from '../../../shared/parcellaires/parcellaires.service.js'
import { NotFoundApiError } from '../../../shared/errors.js'
import { normalizeRecord } from '../../../shared/outputs/record.js'
import type { DBOperatorRecord, NormalizedRecord } from '@agencebio/cartobio-types'
import * as repository from '../imports.repository.js'

const recordFields = 'cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite'

async function getOperatorLastRecord (numeroBio: string | number, { anneeAudit = null, statut = null }: { anneeAudit?: string | number | null; statut?: string | null } = {}) {
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
  { anneeAudit = null, statut = null, anneeReferenceControle = null, limit = null, start = null }: { anneeAudit?: string | number | null; statut?: string | null; anneeReferenceControle?: string | null; limit?: number | null; start?: number | null } = {}
): Promise<NormalizedRecord[]> {
  const conditions: string[] = []
  const values: (string | number)[] = [ocId]
  let paramIndex = 2

  if (anneeAudit) {
    conditions.push(`EXTRACT('year' FROM audit_date) = $${paramIndex}`)
    values.push(anneeAudit)
    paramIndex++
  }

  if (statut) {
    conditions.push(`certification_state = $${paramIndex}`)
    values.push(statut)
    paramIndex++
  }

  if (anneeReferenceControle) {
    conditions.push(`annee_reference_controle = $${paramIndex}`)
    values.push(anneeReferenceControle)
    paramIndex++
  }

  let paginationClause = ''
  if (limit !== null) {
    paginationClause = `LIMIT $${paramIndex}`
    values.push(limit)
    paramIndex++
  }
  if (start !== null) {
    paginationClause += ` OFFSET $${paramIndex}`
    values.push(start)
    paramIndex++
  }

  const sql = `
  SELECT DISTINCT ON (numerobio) ${recordFields}
  FROM cartobio_operators
  WHERE oc_id = $1 AND deleted_at IS NULL
  ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
  ORDER BY numerobio ASC, updated_at DESC
  ${paginationClause}
`

  const { rows } = await repository.query<DBOperatorRecord>(sql, values)

  return Promise.all(rows.map(async row => normalizeRecord(await cartobio.joinRecordParcelles(row))))
}

export { getOperatorLastRecord, iterateOperatorLastRecords }
