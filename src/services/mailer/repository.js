'use strict'

const pool = require('../../../src/database/database.js')

/**
* @param  {string} organismeCertificateur
* @param  {string} start
* @param  {string} end
* @returns {Promise<{totalrecu: string, totalacceptes: string, totalrefuses: string, organismeCertificateur: string} | null>}
 */
async function getStatsByOrganisme (organismeCertificateur, start, end) {
  const query = `
    SELECT
      organisme_certificateur AS organismeCertificateur,
      SUM(nb_objets_recu)     AS totalRecu,
      SUM(nb_objets_acceptes) AS totalAcceptes,
      SUM(nb_objets_refuses)  AS totalRefuses
    FROM parcellaire_import
    WHERE organisme_certificateur = $1
      AND ended_at >= $2
      AND ended_at <= $3

    GROUP BY organisme_certificateur
  `
  const result = await pool.query(query, [organismeCertificateur, start, end])
  return result.rows[0] ?? null
}

module.exports = { getStatsByOrganisme }
