interface ocId {
  ocId?: number
}

interface operatorId {
  operatorId?: number
}

// declare function fetchCustomersByOperator (options: ocId | operatorId): Array.<Operateur>

export type Catégorie = {
  id: number,
  nom: string
}

export type Image = {
  full: string | null,
  large: string | null,
  medium: string | null,
  small: string | null,
}

export type SiteWeb = {
  url: string
}

export type Production = {
  id: number,
  /** Code Insee CPF (Classification des Produits Français) */
  code: string,
  nom: string,
}

export type Activité = {
  id: number,
  nom: string,
  active: boolean
}

export type Département = {
  id: number,
  nom: string
}

export type AdresseOperateur = {
  id: number,
  codePostal: string,
  codeCommune: string,
  ville: string,
  lat: number,
  long: number,
  departementId: Département.id
}

export enum CertificatStatut {
  Active = 'ACTIVE'
}

export enum CertificationStatut {
  Engagée = 'ENGAGEE'
}

export enum NotificationStatut {
  ÀValider = 'A VALIDER',
  Validée = 'VALIDEE'
}

export type Notification = {
  id: number,
  numeroNotification: number | null,
  status: NotificationStatut,
  etatCertification: CertificationStatut,
  dateChangementEffet: string | null,
  dateSuspension: string | null,
  dateFinSuspension: string | null,
  dateArret: string | null,
  dateDemarrage: string | null,
  dateRetrait: string | null,
  dateFinRetrait: string | null,
  dateHabilitation: string | null,
  dateSignatureContrat: string | null,
  numeroClient: string | null,
  url: string | null
  active: boolean,
  operateurId: number,
  productionId: number
}

export type OrganismeCertificateur = {
  id: number,
  nom: string
}

export type Certificat = {
  id: number,
  numeroNotification: number | null,
  commentaire: string | null,
  organisme: string,
  date: string | null,
  status: CertificatStatut,
  etatCertification: CertificationStatut,
  dateSuspension: string | null,
  dateDemarrage: string | null,
  numeroClient: string | null,
  operateurId: number,
  organismeCertificateurId: number,
  productionId: number,
  url: string | null
}

export type Operateur = {
  id: number,
  nom: string,
  denominationCourante: string,
  siret: string,
  numeroBio: number,
  ancienNumeroBio: number | null
  echeanceSiret: any | null,
  telephone: string | null,
  codeNAF: string | null,
  codeNafBio: string | null,
  numeroPacage: string | null,
  dateFinConversion: string | null,
  gerant: string | null,
  mandate: string | null,
  dateEngagement: string | null,
  datePremierEngagement: string | null,
  dateMaj: string,
  createdAt: string,
  nbAverttissementEnvoye: number,
  telephoneCommerciale: string | null,
  active: boolean,
  dispenseSiret: any | null,
  dispenseSiretMotif: any | null,
  flagId: number,
  reseauId: number | null,
  departementId: number | null,
  reseau: string | null,
  categories: Array.<Catégorie>,
  photos: Image,
  siteWebs: Array.<SiteWeb>,
  adressesOperateurs: Array.<AdresseOperateur>,
  productions: Array.<Production>,
  activites: Array.<Activité>,
  notifications: Array.<Notification>,
  certificats: Array.<Certificat>,
  venteDetail: boolean,
  restaurant: boolean,
  nonCertifie: boolean,
  grossiste: boolean,
  magasinSpecialise: boolean,
  artisanCommercant: boolean,
  grandeSurfaceGeneraliste: boolean
}
