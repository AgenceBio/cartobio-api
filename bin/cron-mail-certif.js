#!/usr/bin/env node

const pool = require('../lib/db')
const { sendCertificationComplete } = require('../lib/mailer/utils.js')
const { fetchEmailForNumeroBio } = require('../lib/providers/agence-bio.js')

async function sendMail () {
  try {
    const { rows: parcellaires } = await pool.query(`
      SELECT
        p.record_id,
        p.updated_at,
        p.annee_reference_controle,
        p.numerobio,
        p.version_name
      FROM cartobio_operators p
      WHERE
        p.certification_state = 'CERTIFIED'
        AND p.updated_at > p.date_derniere_notif
    `)

    for (const parcellaire of parcellaires) {
      const emails = await fetchEmailForNumeroBio(parcellaire.numerobio)

      for (const utilisateur of emails.utilisateurs) {
        await sendCertificationComplete(parcellaire, utilisateur.email)
      }

      await pool.query(`
        UPDATE cartobio_operators
        SET date_derniere_notif = NOW()
        WHERE record_id = $1
      `, [parcellaire.record_id])
    }

    process.exit(0)
  } catch (err) {
    console.error('Erreur envoi notification:', err)
    process.exit(1)
  }
}

(async function () {
  await sendMail()
})()
