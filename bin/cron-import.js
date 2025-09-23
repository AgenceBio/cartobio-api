'use strict'

const pool = require('../lib/db')
require('dotenv').config()

async function cleanupJobsImportPayload () {
  try {
    const { rowCount: doneCount } = await pool.query(
      `UPDATE jobs_import
       SET payload = NULL
       WHERE status = 'done'
         AND ended < now() - interval '15 days'
         AND payload IS NOT NULL`
    )

    const { rowCount: errorCount } = await pool.query(
      `UPDATE jobs_import
       SET payload = NULL
       WHERE status = 'error'
         AND ended < now() - interval '3 months'
         AND payload IS NOT NULL`
    )

    return { done: doneCount, error: errorCount }
  } catch (err) {
    console.error('Erreur lors du nettoyage de jobs_import :', err)
    throw err
  }
}

cleanupJobsImportPayload()
  .then(res => {
    console.log('Nettoyage terminé avec succès.', res)
    process.exit(0)
  })
  .catch(err => {
    console.error('Echec du nettoyage :', err)
    process.exit(1)
  })
