'use strict'

const pool = require('../db.js')

/**
* @param  {string} organismeCertificateur
* @param  {string} start
* @param  {string} end
* @returns {Promise<{totalrecu: string, totalacceptes: string, totalrefuses: string, organismeCertificateur: string}>}
 */
async function getStatsByOrganisme (organismeCertificateur, start, end) {
  const [startDay, startMonth, startYear] = start.split('/')
  const [endDay, endMonth, endYear] = end.split('/')

  const startDate = new Date(`${startYear}-${startMonth}-${startDay}T00:00:00`)
  const endDate = new Date(`${endYear}-${endMonth}-${endDay}T23:59:59`)
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
  const result = await pool.query(query, [organismeCertificateur, startDate, endDate])
  if (result.rowCount === 0) throw new Error("Pas d'import API pour l'oc " + organismeCertificateur)

  return result.rows[0]
}

module.exports = { getStatsByOrganisme }
