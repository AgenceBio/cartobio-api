#!/usr/bin/env node

import { sendRapportHebdo } from '../src/services/mailer/utils.js'
import pool from '../src/database/database.js'

async function sendMail (): Promise<void> {
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

(async function (): Promise<void> {
  await sendMail()
})()
