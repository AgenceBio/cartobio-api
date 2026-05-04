'use strict'

const nodemailer = require('nodemailer')
const config = require('../config')
const path = require('path')

const configMail = config.get('mail.mailUrl')
const transporter = nodemailer.createTransport(configMail)

const SIGNATURE_HTML = `
  <br/><br/>
  <a target="_blank" href=${config.get('frontendUrl')}>
    <img src="cid:signature" alt="signature" style="max-width:600px;" />
  </a>
`

const SIGNATURE_ATTACHMENT = {
  filename: 'signature.png',
  path: path.join(process.cwd(), 'lib/mailer/templates/assets', 'signature.png'),
  cid: 'signature'
}

/**
 * Envoie un email.
 *
 * @async
 * @function sendMail
 * @param {Object} options - Options de l'email
 * @param {string|string[]} options.to - Destinataire(s) de l'email
 * @param {string} options.subject - Sujet de l'email
 * @param {string} options.html - Contenu HTML de l'email
 * @param {Array<import('nodemailer').Attachment>} [options.attachments=[]] - Pièces jointes (optionnel)
 *
 * @returns {Promise<import('nodemailer').SentMessageInfo>} Informations sur l'email envoyé
 */
async function sendMail (options) {
  const { attachments = [], html, ...rest } = options

  attachments.push({
    filename: 'logo.png',
    path: path.join(process.cwd(), 'lib/mailer/templates/assets', 'banniere_agence_bio.png'),
    cid: 'logo'
  })

  const info = await transporter.sendMail({
    from: 'no-reply@agencebio.org',
    html: html + SIGNATURE_HTML,
    ...rest,
    attachments: [...attachments, SIGNATURE_ATTACHMENT]
  })

  return info
}

module.exports = {
  transporter,
  sendMail
}
