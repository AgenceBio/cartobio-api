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
