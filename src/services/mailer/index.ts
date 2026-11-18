import nodemailer from 'nodemailer'
import config from '../../config/env.js'
import path from 'path'

const configMail = config.get('mail.mailUrl')
const transporter = nodemailer.createTransport({
  url: configMail
})

const SIGNATURE_HTML = `
  <br/><br/>
  <a target="_blank" href=${config.get('frontendUrl')}>
    <img src="cid:signature" alt="signature" style="max-width:450px;" />
  </a>
`

const SIGNATURE_ATTACHMENT = {
  filename: 'signature.png',
  path: path.join(import.meta.dirname, 'templates/assets/signature.png'),
  cid: 'signature'
}

/**
 * Envoie un email.
 */
async function sendMail (options: { to: string | string[]; subject: string; html: string; attachments?: Array<import('nodemailer/lib/mailer/index.js').Attachment> }): Promise<import('nodemailer').SentMessageInfo> {
  const { attachments = [], html, ...rest } = options

  attachments.push({
    filename: 'logo.png',
    path: path.join(import.meta.dirname, 'templates/assets/banniere_agence_bio.png'),
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

export { transporter, sendMail }
