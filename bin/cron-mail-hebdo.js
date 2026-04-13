#!/usr/bin/env node

const { sendRapportHebdo } = require('../lib/mailer/utils.js')
// TODO : WIP => Comment on gére les différents mails ainsi que les ocIds
async function sendMail () {
  const ocId = 1
  const recipientEmail = 'test@test.fr'

  if (!ocId || !recipientEmail) {
    console.error('OC_ID et RECIPIENT_EMAIL sont requis')
    process.exit(1)
  }

  try {
    await sendRapportHebdo(ocId, recipientEmail)
    console.log(`Rapport envoyé à ${recipientEmail}`)
    process.exit(0)
  } catch (err) {
    console.error('Erreur envoi rapport:', err)
    process.exit(1)
  }
}

(async function () {
  await sendMail()
})()
