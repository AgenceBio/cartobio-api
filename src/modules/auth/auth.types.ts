import type { AgenceBioUserGroup } from '@agencebio/cartobio-types'

export interface UserProfile {
  id: number
  prenom: string
  nom: string
  organismeCertificateur?: { id: number; nom: string }
  groups: AgenceBioUserGroup[]
  mainGroup: { id?: string; nom?: string | null }
}

export interface DepartementRow {
  nomRegion: string
  code: string
  nom: string
}
