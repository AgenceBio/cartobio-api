import pool from '../../database/database.js'
import type { AgenceBioNormalizedOperator, AgenceBioNormalizedOperatorWithRecord, AgenceBioNormalizedOperatorWithFilterData } from '@agencebio/cartobio-types'

const recordFields = /* sqlFragment */ `certification_state,audit_date,certification_date_debut,created_at,numerobio, metadata,record_id,updated_at,annee_reference_controle,version_name, (audit_history->jsonb_array_length(audit_history) - 1)->>'user' AS user `

async function getFilterData (operators: AgenceBioNormalizedOperator[], mixite = false): Promise<AgenceBioNormalizedOperatorWithFilterData[]> {
  operators = operators.sort((a, b) => (+a.numeroBio - +b.numeroBio))
  const ids = operators.map(({ numeroBio }) => String(numeroBio))

  if (ids.length === 0) {
    return []
  }

  const CTE: string[] = []
  const select: string[] = []

  if (mixite === true) {
    CTE.push(`last_certified_parcelle AS (
    SELECT DISTINCT ON (numerobio) numerobio, certification_date_debut AS lastCertifiedDate, mixite as lastMixiteState
    FROM cartobio_operators
    WHERE numerobio = ANY ($1)
      AND certification_state = 'CERTIFIED'
      AND deleted_at IS NULL
    ORDER BY numerobio, certification_date_debut DESC NULLS LAST
    )`)
    select.push('last_certified_parcelle.lastMixiteState')
  }

  CTE.push(`all_parcellaire AS (
  SELECT numerobio,
  JSON_AGG(JSON_BUILD_OBJECT('certification_state', certification_state, 'annee_reference_controle', annee_reference_controle)) as states,
  JSON_AGG(oc_id) as list_oc_id,
  MAX(audit_date) as max_audit_date
  FROM cartobio_operators
  WHERE numerobio = ANY ($1)
  AND deleted_at IS NULL
  GROUP BY numerobio
  )`)
  select.push(' all_parcellaire.numerobio')
  select.push('all_parcellaire.states')
  select.push('all_parcellaire.list_oc_id')
  select.push('all_parcellaire.max_audit_date')
  const { rows } = await pool
    .query(/* sql */`
WITH
  ${CTE.join(',')}
SELECT
  ${select.join(',')}
FROM all_parcellaire
  ${mixite === true ? 'LEFT JOIN last_certified_parcelle ON all_parcellaire.numerobio = last_certified_parcelle.numerobio' : ''}
ORDER BY all_parcellaire.numerobio::bigint ASC
`,
    [ids])

  const res: AgenceBioNormalizedOperatorWithFilterData[] = []
  let j = 0

  for (let i = 0; i < operators.length; i++) {
    if (j === rows.length || +operators[i].numeroBio !== +rows[j].numerobio) {
      res.push({
        ...operators[i],
        metadata: {}
      })

      continue
    }

    const { metadata, ...record } = rows[j]

    res.push({
      ...operators[i],
      metadata,
      ...record
    })
    j++
  }

  return res
}

async function addRecordData (operateur: AgenceBioNormalizedOperator): Promise<AgenceBioNormalizedOperatorWithRecord> {
  const { rows } = await pool
    .query(/* sql */`
WITH latest_by_state AS (
    SELECT DISTINCT ON (numerobio) *
    FROM cartobio_operators
    WHERE numerobio = $1
      AND deleted_at IS NULL
      AND certification_state IN ('AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED')
    ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at) DESC
),
latest_global AS (
    SELECT DISTINCT ON (numerobio) *
    FROM cartobio_operators
    WHERE numerobio = $1
      AND deleted_at IS NULL
    ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at) DESC
),
last_certified_parcelle AS (
    SELECT DISTINCT ON (numerobio) numerobio, annee_reference_controle AS lastCertifiedDate, mixite as lastMixiteState
    FROM cartobio_operators
    WHERE numerobio = $1
      AND certification_state = 'CERTIFIED'
      AND deleted_at IS NULL
    ORDER BY numerobio, certification_date_debut DESC NULLS LAST
)
SELECT
    combined_results.*,
    last_certified_parcelle.lastCertifiedDate,
    last_certified_parcelle.lastMixiteState
FROM (
    SELECT ${recordFields} FROM latest_by_state
    UNION
    SELECT ${recordFields} FROM latest_global
) AS combined_results
LEFT JOIN last_certified_parcelle ON combined_results.numerobio = last_certified_parcelle.numerobio
ORDER BY combined_results.numerobio, COALESCE(combined_results.certification_date_debut, combined_results.audit_date, combined_results.created_at) DESC;
    `,
    [operateur.numeroBio])

  const matchingRows = rows.filter(({ numerobio }) => numerobio === String(operateur.numeroBio))

  if (!Array.isArray(matchingRows) || matchingRows.length === 0) {
    return { ...operateur, metadata: {} }
  }
  matchingRows.sort((a, b) => {
    return +(a.certification_state === 'OPERATOR_DRAFT') - +(b.certification_state === 'OPERATOR_DRAFT')
  })
  const [primaryRecord, ...otherRecords] = matchingRows
  const { metadata, ...record } = primaryRecord || { metadata: {} }

  return {
    ...operateur,
    metadata,
    ...record,
    otherParcellaire: otherRecords.length > 0 ? otherRecords : null
  }
}

async function findConsultedOperators (userId: number): Promise<number[]> {
  const { rows } = await pool
    .query(/* sql */`SELECT numerobio
      FROM operateurs_consultes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [userId])

  return rows.map((r) => r.numerobio)
}

type NumeroBio = string | number

export type ImportPacRow = {
  size: string
  nb_parcelles: string
  pacage: string
  imported: boolean
  record: Record<string, unknown>
}

async function pinOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await pool.query(
    "INSERT INTO operateurs_epingles (numerobio, user_id) VALUES ($1, $2) ON CONFLICT (numerobio, user_id) DO NOTHING",
    [numeroBio, userId]
  );
}
async function unpinOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await pool.query(
    "DELETE FROM operateurs_epingles WHERE numerobio = $1 AND user_id = $2",
    [numeroBio, userId]
  );
}
async function consultOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await pool.query(
    "INSERT INTO operateurs_consultes (numerobio, user_id) VALUES ($1, $2) ON CONFLICT (numerobio, user_id) DO UPDATE SET created_at = now()",
    [numeroBio, userId]
  );
}
async function findImportPac(numeroBio: NumeroBio): Promise<ImportPacRow | null> {
  const { rows } = await pool.query<ImportPacRow>(
    "SELECT size, nb_parcelles, pacage, imported, record FROM import_pac_26 WHERE numerobio = $1",
    [numeroBio]
  );
  return rows[0] ?? null;
}
async function hideImport(numeroBio: NumeroBio): Promise<void> {
  await pool.query(
    "UPDATE import_pac_26 SET imported = true WHERE numerobio = $1",
    [numeroBio]
  );
}
async function findPinnedOperators(userId: number): Promise<number[]> {
  const { rows } = await pool.query<{ numerobio: number }>(
    "SELECT numerobio FROM operateurs_epingles WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(({ numerobio }) => numerobio);
}
async function findDashboardStates(numeroBios: string[], anneeReferenceControle: number): Promise<Array<{ certifie: boolean; numerobios: string[] }>> {
  const { rows } = await pool.query<{ certifie: boolean; numerobios: string[] }>(
    `SELECT (certification_state = 'CERTIFIED') AS certifie, JSON_AGG(DISTINCT numerobio) AS numerobios FROM cartobio_operators WHERE numerobio = ANY($1) AND deleted_at IS NULL AND annee_reference_controle = $2 AND certification_state IN ('AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED') GROUP BY certification_state = 'CERTIFIED'`,
    [numeroBios, anneeReferenceControle]
  );
  return rows;
}
export {
  pinOperator,
  unpinOperator,
  consultOperator,
  findImportPac,
  hideImport,
  findPinnedOperators,
  findDashboardStates,
  findConsultedOperators,
  getFilterData,
  addRecordData
}
