import nodemailer from 'nodemailer'
import config from '../../config/env.js'
import path from 'path'
import { MAIL_TEMPLATES_DIR } from '../../shared/paths.js'

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
  path: path.join(MAIL_TEMPLATES_DIR, 'assets/signature.png'),
  cid: 'signature'
}

/**
 * Envoie un email.
 */
async function sendMail(options: {
  to: string | string[]
  subject: string
  html: string
  attachments?: Array<import('nodemailer/lib/mailer/index.js').Attachment>
}): Promise<import('nodemailer').SentMessageInfo> {
  const { attachments = [], html, ...rest } = options

  attachments.push({
    filename: 'logo.png',
    path: path.join(MAIL_TEMPLATES_DIR, 'assets/banniere_agence_bio.png'),
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

export { sendMail }
