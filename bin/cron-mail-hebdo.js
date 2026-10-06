#!/usr/bin/env node

const { sendRapportHebdo } = require('../src/services/mailer/utils.js')
const pool = require('../src/database/database')

async function sendMail () {
  const { rows: ocList } = await pool.query(`
      SELECT id, label, UNNEST(emails) AS email
      FROM organisme_certificateur
      WHERE active = true
    `)

  if (!ocList) {
    console.error('Aucun organisme certificateur')
    process.exit(1)
  }

  try {
    for (const oc of ocList) {
      await sendRapportHebdo(oc.id, oc.email, oc.label)
      console.log(`Rapport envoyé à ${oc.email}`)
    }
    process.exit(0)
  } catch (err) {
    console.error('Erreur envoi rapport:', err)
    process.exit(1)
  }
}

(async function () {
  await sendMail()
})()
