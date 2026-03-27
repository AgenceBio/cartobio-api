'use strict'

import fs from 'fs'
import path from 'path'

import { sendMail } from './index.js'
import config from '../config.js'

/**
 * Échappe les caractères HTML dangereux
 *
 * @param {any} value
 * @returns {string}
 */
function sanitize (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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
    const value = sanitize(variables[key])
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
    version_name: record.version_name.toString(),
    url: `${config.get('frontendUrl')}/exploitations/${record.numerobio}/${record.record_id}`
  })

  return sendMail({
    to: recipientEmail,
    subject: `Attestation de production ${record.annee_reference_controle} CartoBio `,
    html
  })
}
