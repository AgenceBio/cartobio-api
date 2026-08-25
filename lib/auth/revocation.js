const { createHash } = require('node:crypto')
const pool = require('../db')

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

async function revokeToken (token, exp) {
  if (exp - Math.floor(Date.now() / 1000) <= 0) return
  await pool.query(
    `INSERT INTO revoked_tokens (token_hash, expires_at)
     VALUES ($1, to_timestamp($2))
     ON CONFLICT (token_hash) DO NOTHING`,
    [hashToken(token), exp]
  )
}

async function isRevoked (token) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM revoked_tokens WHERE token_hash = $1',
    [hashToken(token)]
  )
  return rowCount > 0
}

module.exports = { revokeToken, isRevoked }
