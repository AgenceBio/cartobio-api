'use strict'

import fs from 'fs'
import path from 'path'

import { sendMail } from './index.js'

/**
 * Charge un template HTML et remplace les variables
 *
 * @param {string} templateName - Nom du fichier template (sans extension)
 * @param {Object} variables - Variables à injecter dans le template
 * @returns {string} HTML final
 */
function renderTemplate (templateName, variables) {
  const filePath = path.join(
    process.cwd(),
    'lib/mailer/templates',
    `${templateName}.html`
  )
  let html = fs.readFileSync(filePath, 'utf-8')

  for (const key in variables) {
    const value = variables[key] ?? ''
    html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value)
  }

  return html
}

/**
   * Envoie un email de certification complète.
   *
   * @async
   * @param {any} record - Données du record
   * @param {string} recipientEmail - Email du destinataire
   * @returns {Promise<import('nodemailer').SentMessageInfo>}
   */
export async function sendCertificationComplete (record, recipientEmail) {
  const html = renderTemplate('CERTIFICATION', {
    operatorNom: record.numerobio.toString(),
    numeroBio: record.numerobio.toString(),
    auditDate: record.audit_date || '',
    certifDateFin: record.certification_date_fin || ''
  })

  console.log(html)

  return sendMail({
    to: recipientEmail,
    subject: `Parcellaire certifié — numéro bio ${record.numerobio}`,
    html
  })
}
