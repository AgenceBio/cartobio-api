"use strict";

const pool = require("../../../src/database/database.js");

async function pinOperator(numeroBio, userId) {
  await pool.query(
    "INSERT INTO operateurs_epingles (numerobio, user_id) VALUES ($1, $2) ON CONFLICT (numerobio, user_id) DO NOTHING",
    [numeroBio, userId]
  );
}
async function unpinOperator(numeroBio, userId) {
  await pool.query(
    "DELETE FROM operateurs_epingles WHERE numerobio = $1 AND user_id = $2",
    [numeroBio, userId]
  );
}
async function consultOperator(numeroBio, userId) {
  await pool.query(
    "INSERT INTO operateurs_consultes (numerobio, user_id) VALUES ($1, $2) ON CONFLICT (numerobio, user_id) DO UPDATE SET created_at = now()",
    [numeroBio, userId]
  );
}
async function findImportPac(numeroBio) {
  const { rows } = await pool.query(
    "SELECT size, nb_parcelles, pacage, imported, record FROM import_pac_26 WHERE numerobio = $1",
    [numeroBio]
  );
  return rows[0] ?? null;
}
async function hideImport(numeroBio) {
  await pool.query(
    "UPDATE import_pac_26 SET imported = true WHERE numerobio = $1",
    [numeroBio]
  );
}
async function findPinnedOperators(userId) {
  const { rows } = await pool.query(
    "SELECT numerobio FROM operateurs_epingles WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(({ numerobio }) => numerobio);
}
async function findDashboardStates(numeroBios, anneeReferenceControle) {
  const { rows } = await pool.query(
    `SELECT (certification_state = 'CERTIFIED') AS certifie, JSON_AGG(DISTINCT numerobio) AS numerobios FROM cartobio_operators WHERE numerobio = ANY($1) AND deleted_at IS NULL AND annee_reference_controle = $2 AND certification_state IN ('AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED') GROUP BY certification_state = 'CERTIFIED'`,
    [numeroBios, anneeReferenceControle]
  );
  return rows;
}
module.exports = {
  pinOperator,
  unpinOperator,
  consultOperator,
  findImportPac,
  hideImport,
  findPinnedOperators,
  findDashboardStates,
};
