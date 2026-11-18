import pool from '../../database/database.js'

export interface DepartementRow {
  nom_region: string
  code: string
  nom: string
}

async function findDepartements (): Promise<DepartementRow[]> {
  const { rows } = await pool.query<DepartementRow>("SELECT CASE WHEN LENGTH(d.code) = 3 THEN 'DOM-TOM' ELSE r.nom END AS nom_region, d.code, d.nom FROM departement d LEFT JOIN region r ON d.code_region = r.code")
  return rows
}

async function insertRevokedToken (tokenHash: string, expiration: number): Promise<void> {
  await pool.query(
    'INSERT INTO revoked_tokens (token_hash, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT (token_hash) DO NOTHING',
    [tokenHash, expiration]
  )
}

async function hasRevokedToken (tokenHash: string) {
  const { rowCount } = await pool.query('SELECT 1 FROM revoked_tokens WHERE token_hash = $1', [tokenHash])
  return (rowCount ?? 0) > 0
}

export { findDepartements, insertRevokedToken, hasRevokedToken }
