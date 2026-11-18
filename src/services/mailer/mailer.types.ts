import type { Attachment } from 'nodemailer/lib/mailer/index.js'

export type MailOptions = {
  to: string | string[]
  subject: string
  html: string
  attachments?: Attachment[]
}

export type CertificationMailRecord = {
  version_name: string
  numerobio: string
  record_id: string | number
  annee_reference_controle?: number | null
}

export type StatsOrganisme = {
  organismeCertificateur: string
  totalRecu: number
  totalAcceptes: number
  totalRefuses: number
}

export type DestinataireRapport = {
  id: string
  label: string
  email: string
}
