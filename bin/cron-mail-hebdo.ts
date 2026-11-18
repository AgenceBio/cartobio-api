#!/usr/bin/env node

import { sendRapportHebdo } from '../src/services/mailer/utils.js'
import { getDestinatairesRapport } from '../src/services/mailer/repository.js'

async function sendMail (): Promise<void> {
  const ocList = await getDestinatairesRapport()

  if (!ocList.length) {
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
