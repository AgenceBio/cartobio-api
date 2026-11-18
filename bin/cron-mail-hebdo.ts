#!/usr/bin/env node

import { sendRapportHebdo } from '../src/services/mailer/mailer.service.js'
import { getDestinatairesRapport } from '../src/services/mailer/mailer.repository.js'

async function sendMail(): Promise<void> {
  const ocList = await getDestinatairesRapport()

  if (!ocList.length) {
    console.error('Aucun organisme certificateur')
    process.exit(1)
  }

  let errors = 0
  for (const oc of ocList) {
    try {
      await sendRapportHebdo(oc.id, oc.email, oc.label)
      console.log(`Rapport envoyé à l'OC ${oc.id}`)
    } catch (err) {
      errors++
      console.error(`Erreur envoi rapport à l'OC ${oc.id}:`, err)
    }
  }
  process.exit(errors > 0 ? 1 : 0)
}

;(async function (): Promise<void> {
  await sendMail()
})()
