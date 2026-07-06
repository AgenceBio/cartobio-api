const fs = require('fs')
const path = require('path')

const { sendMail } = require('./index.js')
const config = require('../config.js')
const { getStatsByOrganisme } = require('../providers/stats-api.js')

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
 * Retourne les dates de debut et fin de semaine
 *
 * @returns {{dateDebut : string, dateFin :string}} Les deux dates dans un objet
 */
const getLastWeekDates = () => {
  const today = new Date()
  const dayOfWeek = today.getDay()

  const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek

  const lastMonday = new Date(today)
  lastMonday.setDate(today.getDate() + diffToMonday - 7)

  const lastSunday = new Date(lastMonday)
  lastSunday.setDate(lastMonday.getDate() + 6)

  const format = (date) => date.toISOString().split('T')[0]

  return {
    dateDebut: format(lastMonday),
    dateFin: format(lastSunday)
  }
}

/**
   * Envoie un email de certification complète.
   *
   * @async
   * @param {any} record - Données du record
   * @param {string} recipientEmail - Email du destinataire
   * @returns {Promise<import('nodemailer').SentMessageInfo>}
   */
async function sendCertificationComplete (record, recipientEmail) {
  const html = renderTemplate('CERTIFICATION', {
    version_name: record.version_name.toString(),
    url: `${config.get('frontendUrl')}/exploitations/${record.numerobio}/${record.record_id}`
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : votre attestation de production ${record.annee_reference_controle} est disponible`,
    html
  })
}

/**
   * Envoie un email de certification complète modifié.
   *
   * @async
   * @param {any} record - Données du record
   * @param {string} recipientEmail - Email du destinataire
   * @returns {Promise<import('nodemailer').SentMessageInfo>}
   */
async function sendCertificationCompleteModifie (record, recipientEmail) {
  const html = renderTemplate('CERTIFICATION_MODIF', {
    version_name: record.version_name.toString(),
    url: `${config.get('frontendUrl')}/exploitations/${record.numerobio}/${record.record_id}`
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : votre attestation de production ${record.annee_reference_controle} a été mise à jour`,
    html
  })
}

/**
   * Envoie un email de certification complète.
   *
   * @async
   * @param {string} ocId - Id de l'organisme certificateur
   * @param {string} recipientEmail - Email du destinataire
   * @param {string} labelOc - Label de l'organisme certificateur
   * @returns {Promise<import('nodemailer').SentMessageInfo>}
   */
async function sendRapportHebdo (ocId, recipientEmail, labelOc) {
  const { dateDebut, dateFin } = getLastWeekDates()
  const result = await getStatsByOrganisme(ocId, dateDebut, dateFin)
  const html = renderTemplate('RAPPORT_HEBDO_API', {
    date_debut: new Date(dateDebut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    date_fin: new Date(dateFin).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    nb_envoye: result?.totalrecu ?? 0,
    nb_traite: result?.totalacceptes ?? 0,
    nb_error: result?.totalrefuses ?? 0,
    oc_label: labelOc,
    url: `${config.get('frontendUrl')}/api/v3/import/parcellaire-imports?from=${dateDebut}&to=${dateFin}&withRejected=true`
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : Bilan hebdomadaire des envois API : du ${new Date(dateDebut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} au ${new Date(dateFin).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
    html
  })
}

module.exports = {
  sendCertificationComplete,
  sendCertificationCompleteModifie,
  sendRapportHebdo
}
