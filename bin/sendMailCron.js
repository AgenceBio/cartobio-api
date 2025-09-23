'use strict'

const pool = require('../lib/db')
const maildev = require('../lib/mailDev')
require('dotenv').config()

async function generateWeeklyImportMail () {
  try {
    // TODO : Boucle a faire pour tous les organismes certificateurs
    const organismeCertificateur = '1'
    const { rows } = await pool.query(
      `SELECT i.id, i.started_at, i.objets_acceptes, i.objets_refuses, l.type, l.message, l.numero_bio
       FROM parcellaire_imports i
       LEFT JOIN parcellaire_import_logs l ON l.import_id = i.id
       WHERE i.organisme_certificateur = $1
         AND i.started_at >= now() - interval '7 days'
       ORDER BY i.started_at, l.type`,
      [organismeCertificateur]
    )

    if (rows.length === 0) {
      return `Aucun import pour ${organismeCertificateur} cette semaine.`
    }

    const importsMap = new Map()
    for (const row of rows) {
      if (!importsMap.has(row.id)) {
        importsMap.set(row.id, {
          started_at: row.started_at,
          objets_acceptes: row.objets_acceptes,
          objets_refuses: row.objets_refuses,
          errors: [],
          warnings: []
        })
      }
      if (row.type === 'error') {
        importsMap.get(row.id).errors.push(`#${row.numero_bio} ${row.message}`)
      }
      if (row.type === 'warning') {
        importsMap.get(row.id).warnings.push(`#${row.numero_bio || ''} : ${row.message}`)
      }
    }

    let mailText = `Rapport hebdo des imports pour ${organismeCertificateur}\n\n`
    for (const [, imp] of importsMap.entries()) {
      mailText += `Import du ${imp.started_at}\n`
      mailText += `- Objets traités : ${imp.objets_acceptes.length + imp.objets_refuses.length}\n`
      mailText += `- Acceptés : ${JSON.stringify(imp.objets_acceptes, null, 2)}\n`
      mailText += `- Refusés : ${JSON.stringify(imp.objets_refuses, null, 2)}\n\n`
      if (imp.errors.length) {
        mailText += `Erreurs :\n${imp.errors.map(e => '- ' + e).join('\n')}\n\n`
      }
      if (imp.warnings.length) {
        mailText += `Warnings :\n${imp.warnings.map(w => '- ' + w).join('\n')}\n\n`
      }
      mailText += '--------------------------\n\n'
    }
    maildev.sendMail('test@test.com', 'test', mailText)
  } catch (err) {
    console.error('Erreur lors de la génération du rapport hebdo :', err)
    throw err
  }
}
generateWeeklyImportMail()
