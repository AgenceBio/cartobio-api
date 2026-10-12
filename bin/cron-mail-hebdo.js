#!/usr/bin/env node

const { sendRapportHebdo } = require('../lib/mailer/utils.js')
const pool = require('../lib/db')

async function sendMail () {
  const { rows: ocList } = await pool.query(`
      SELECT id, label, UNNEST(emails) AS email
      FROM organisme_certificateur
      WHERE active = true
    `)

  if (!ocList.length) {
    console.error('Aucun organisme certificateur')
    process.exit(1)
  }

  let hasError = false
  for (const oc of ocList) {
    try {
      await sendRapportHebdo(oc.id, oc.email, oc.label)
      console.log(`Rapport envoyé à ${oc.email}`)
    } catch (err) {
      hasError = true
      console.error(`Erreur envoi rapport à ${oc.email}:`, err)
    }
  }

  await pool.end()
  process.exit(hasError ? 1 : 0)
}

(async function () {
  await sendMail()
})()
