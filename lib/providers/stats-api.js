'use strict'

const pool = require('../db.js')

/**
* @param  {string} organismeCertificateur
* @param  {string} start
* @param  {string} end
* @returns {Promise<{totalrecu: string, totalacceptes: string, totalrefuses: string, organismeCertificateur: string} | null>}
 */
async function getStatsByOrganisme (organismeCertificateur, start, end) {
  const startDate = new Date(start)
  const endDate = new Date(`${end}T23:59:59`)

  const query = `
    SELECT
      organisme_certificateur AS organismeCertificateur,
      COUNT(*)                                                   AS totalRecu,
      COUNT(*) FILTER (WHERE statut_job = 'VALID')               AS totalAcceptes,
      COUNT(*) FILTER (WHERE statut_job IS DISTINCT FROM 'VALID') AS totalRefuses
    FROM parcellaire_import
    WHERE organisme_certificateur = $1
      AND ended_at >= $2
      AND ended_at <= $3

    GROUP BY organisme_certificateur
  `
  const result = await pool.query(query, [organismeCertificateur, startDate, endDate])
  if (result.rowCount === 0) {
    console.warn("Pas d'import API pour l'oc " + organismeCertificateur)
    return null
  }

  return result.rows[0]
}

module.exports = { getStatsByOrganisme }
