import pool from '../../database/database.js'

async function getStatsByOrganisme (organismeCertificateur: string, start: Date | string, end: Date | string): Promise<{ totalrecu: string; totalacceptes: string; totalrefuses: string; organismeCertificateur: string } | null> {
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

export { getStatsByOrganisme }
