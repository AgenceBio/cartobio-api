'use strict'

const nodemailer = require('nodemailer')

require('dotenv').config({ path: '../.env' })

const transporter = nodemailer.createTransport(
  {
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    secure: process.env.MAIL_SECURE === 'true',
    requireTLS: process.env.MAIL_REQUIRETLS === 'true',
    auth:
      process.env.MAIL_USER &&
      process.env.MAIL_USER !== '' &&
      process.env.MAIL_PASSWORD &&
      process.env.MAIL_PASSWORD !== ''
        ? {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASSWORD
          }
        : undefined
  },
  { from: process.env.MAIL_FROM }
)

/**
 * Envoie un mail de dev
 * @param {string|string[]} to - destinataire(s)
 * @param {string} subject - sujet
 * @param {string} text - contenu du mail
 */
async function sendMail (to, subject, text) {
  await transporter.sendMail({
    to,
    subject,
    text
  })
}

module.exports = { sendMail }
