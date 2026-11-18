import type { SentMessageInfo } from 'nodemailer'
import config from '../../config/env.js'
import { findStatsByOrganisme } from './mailer.repository.js'
import type { CertificationMailRecord } from './mailer.types.js'
import { formatDateFr, getLastWeekDates, operatorRecordUrl, renderTemplate, sendMail } from './mailer.utils.js'

export async function sendCertificationComplete(
  record: CertificationMailRecord,
  recipientEmail: string
): Promise<SentMessageInfo> {
  const html = renderTemplate('CERTIFICATION', {
    version_name: record.version_name,
    url: operatorRecordUrl(record.numerobio, record.record_id)
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : votre attestation du parcellaire ${record.annee_reference_controle} est disponible`,
    html
  })
}

export async function sendCertificationCompleteModifie(
  record: CertificationMailRecord,
  recipientEmail: string
): Promise<SentMessageInfo> {
  const html = renderTemplate('CERTIFICATION_MODIF', {
    version_name: record.version_name,
    url: operatorRecordUrl(record.numerobio, record.record_id)
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : votre attestation du parcellaire ${record.annee_reference_controle} a été mise à jour`,
    html
  })
}

export async function sendRapportHebdo(
  ocId: number,
  recipientEmail: string,
  labelOc: string
): Promise<SentMessageInfo> {
  const { dateDebut, dateFin } = getLastWeekDates()
  const stats = await findStatsByOrganisme(ocId, new Date(dateDebut), new Date(`${dateFin}T23:59:59`))
  const html = renderTemplate('RAPPORT_HEBDO_API', {
    date_debut: formatDateFr(dateDebut),
    date_fin: formatDateFr(dateFin),
    nb_envoye: stats?.totalRecu ?? 0,
    nb_traite: stats?.totalAcceptes ?? 0,
    nb_error: stats?.totalRefuses ?? 0,
    oc_label: labelOc,
    url: `${config.get('frontendUrl')}/api/v3/import/parcellaire-imports?from=${dateDebut}&to=${dateFin}&withRejected=true`
  })

  return sendMail({
    to: recipientEmail,
    subject: `CartoBio : Bilan hebdomadaire des envois API : du ${formatDateFr(dateDebut)} au ${formatDateFr(dateFin)}`,
    html
  })
}
