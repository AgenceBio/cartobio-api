#!/usr/bin/env node

const { sendRapportHebdo } = require('../lib/mailer/utils.js')
const pool = require('../lib/db')

// TODO : WIP => Comment on gére les différents mails ainsi que les ocIds
async function sendMail () {
  const { rows: ocList } = await pool.query(`
      SELECT id, email
      FROM organisme_certificateur
      WHERE active = true
    `)

  if (!ocList) {
    console.error('Aucun organisme certificateur')
    process.exit(1)
  }

  try {
    for (const oc in ocList) {
      await sendRapportHebdo(oc.id, oc.email)
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
