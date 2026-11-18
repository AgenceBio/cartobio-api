#!/usr/bin/env node

import { db } from '../src/database/database.js'
import { sendRapportHebdo } from '../src/services/mailer/mailer.service.js'
import { findDestinatairesRapport } from '../src/services/mailer/mailer.repository.js'

try {
  const ocList = await findDestinatairesRapport()

  if (!ocList.length) {
    console.error('Aucun organisme certificateur')
    process.exitCode = 1
  }

  for (const oc of ocList) {
    try {
      await sendRapportHebdo(oc.id, oc.email, oc.label)
      console.log(`Rapport envoyé à l'OC ${oc.id}`)
    } catch (err) {
      process.exitCode = 1
      console.error(`Erreur envoi rapport à l'OC ${oc.id}:`, err)
    }
  }
} finally {
  await db.$client.end()
}
