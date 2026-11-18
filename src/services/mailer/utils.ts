import fs from 'fs'
import path from 'path'

import { sendMail } from './index.js'
import config from '../../config/env.js'
import { getStatsByOrganisme } from './repository.js'

type CertificationMailRecord = {
  version_name: string
  numerobio: string
  record_id: string | number
  annee_reference_controle?: number | null
}

/**
 * Échappe les caractères HTML dangereux
 */
function sanitize (value: unknown): string {
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
 * @param templateName Nom du fichier template (sans extension)
 * @param variables Variables à injecter dans le template
 * @returns HTML final
 */
function renderTemplate (templateName: string, variables: Record<string, unknown>): string {
  const filePath = path.join(import.meta.dirname, 'templates', `${templateName}.html`)
  let html = fs.readFileSync(filePath, 'utf-8')

  for (const key in variables) {
    const value = sanitize(variables[key])
    html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value)
  }

  return html
}

/**
 * Retourne les dates de debut et fin de semaine
 */
const getLastWeekDates = (): { dateDebut: string; dateFin: string } => {
  const today = new Date()
  const dayOfWeek = today.getDay()

  const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek

  const lastMonday = new Date(today)
  lastMonday.setDate(today.getDate() + diffToMonday - 7)

  const lastSunday = new Date(lastMonday)
  lastSunday.setDate(lastMonday.getDate() + 6)

  const format = (date: Date) => date.toISOString().split('T')[0]

  return {
    dateDebut: format(lastMonday),
    dateFin: format(lastSunday)
  }
}

/**
 * Envoie un email de certification complète.
 */
async function sendCertificationComplete (record: CertificationMailRecord, recipientEmail: string): Promise<import('nodemailer').SentMessageInfo> {
  const html = renderTemplate('CERTIFICATION', {
    version_name: record.version_name.toString(),
    url: `${config.get('frontendUrl')}/exploitations/${record.numerobio}/${record.record_id}`
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : votre attestation du parcellaire ${record.annee_reference_controle} est disponible`,
    html
  })
}

/**
 * Envoie un email de certification complète modifié.
 */
async function sendCertificationCompleteModifie (record: CertificationMailRecord, recipientEmail: string): Promise<import('nodemailer').SentMessageInfo> {
  const html = renderTemplate('CERTIFICATION_MODIF', {
    version_name: record.version_name.toString(),
    url: `${config.get('frontendUrl')}/exploitations/${record.numerobio}/${record.record_id}`
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : votre attestation du parcellaire ${record.annee_reference_controle} a été mise à jour`,
    html
  })
}

/**
 * Envoie un email de certification complète.
 */
async function sendRapportHebdo (ocId: string, recipientEmail: string, labelOc: string): Promise<import('nodemailer').SentMessageInfo> {
  const { dateDebut, dateFin } = getLastWeekDates()
  const result = await getStatsByOrganisme(
    ocId,
    new Date(dateDebut),
    new Date(`${dateFin}T23:59:59`)
  )
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

export { sendCertificationComplete, sendCertificationCompleteModifie, sendRapportHebdo }
