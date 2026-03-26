'use strict'

const nodemailer = require('nodemailer')
const config = require('../config')
const path = require('path')

const configMail = config.get('mail.mailUrl')
const transporter = nodemailer.createTransport(configMail)

transporter.verify((error) => {
  if (error) {
    console.error('[mailer] connexion SMTP impossible :', error)
  } else {
    console.log('[mailer] connexion SMTP OK')
  }
})

const SIGNATURE_HTML = `
  <br/><br/>
  <img src="cid:signature" alt="signature" style="max-width:300px;" />
`

const SIGNATURE_ATTACHMENT = {
  filename: 'signature.png',
  path: path.join(__dirname, 'assets', 'signature.png'),
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
 * @param {Array<import('nodemailer').Attachment>} [options.attachments=null] - Pièces jointes (optionnel)
 *
 * @returns {Promise<import('nodemailer').SentMessageInfo>} Informations sur l'email envoyé
 */
async function sendMail (options) {
  const { attachments = null, html, ...rest } = options

  const info = transporter.sendMail({
    from: 'no-reply@cartobio.org',
    html: html + SIGNATURE_HTML,
    ...rest,
    attachments
  })

  return info
}

module.exports = {
  transporter,
  sendMail
}
