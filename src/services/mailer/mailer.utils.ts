import fs from 'node:fs'
import path from 'node:path'
import nodemailer from 'nodemailer'
import type { SentMessageInfo } from 'nodemailer'
import type { Attachment } from 'nodemailer/lib/mailer/index.js'
import config from '../../config/env.js'
import { escapeHtml } from '../../shared/html.js'
import { MAIL_TEMPLATES_DIR } from '../../shared/paths.js'
import type { MailOptions } from './mailer.types.js'

const transporter = nodemailer.createTransport({
  url: config.get('mail.mailUrl'),
  requireTLS: config.get('env') === 'production'
})

const SIGNATURE_HTML = `
  <br/><br/>
  <a target="_blank" href=${config.get('frontendUrl')}>
    <img src="cid:signature" alt="signature" style="max-width:450px;" />
  </a>
`

const DEFAULT_ATTACHMENTS: Attachment[] = [
  {
    filename: 'logo.png',
    path: path.join(MAIL_TEMPLATES_DIR, 'assets/banniere_agence_bio.png'),
    cid: 'logo'
  },
  {
    filename: 'signature.png',
    path: path.join(MAIL_TEMPLATES_DIR, 'assets/signature.png'),
    cid: 'signature'
  }
]

export async function sendMail({ attachments = [], html, ...rest }: MailOptions): Promise<SentMessageInfo> {
  return transporter.sendMail({
    from: 'no-reply@agencebio.org',
    html: html + SIGNATURE_HTML,
    ...rest,
    attachments: [...attachments, ...DEFAULT_ATTACHMENTS]
  })
}

export function renderTemplate(templateName: string, variables: Record<string, unknown>): string {
  let html = fs.readFileSync(path.join(MAIL_TEMPLATES_DIR, `${templateName}.html`), 'utf-8')

  for (const key in variables) {
    const value = escapeHtml(variables[key])
    html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), () => value)
  }

  return html
}

export function getLastWeekDates(): { dateDebut: string; dateFin: string } {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek

  const lastMonday = new Date(today)
  lastMonday.setDate(today.getDate() + diffToMonday - 7)

  const lastSunday = new Date(lastMonday)
  lastSunday.setDate(lastMonday.getDate() + 6)

  const format = (date: Date): string => date.toISOString().slice(0, 10)

  return {
    dateDebut: format(lastMonday),
    dateFin: format(lastSunday)
  }
}

export const formatDateFr = (date: string): string =>
  new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

export const operatorRecordUrl = (numerobio: string, recordId: string | number): string =>
  `${config.get('frontendUrl')}/exploitations/${numerobio}/${recordId}`
