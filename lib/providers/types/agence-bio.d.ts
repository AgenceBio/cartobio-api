/****
 * Types which depends on the Agence Bio API
 */

export type OrganismeCertificateur = {
    id: number;
    nom: string;
    numeroControleEu?: string | undefined;
};

/**
 * An operator as returned by Agence Bio API
 */
export type AgenceBioOperator = {
    id: number;
    nom: string;
    denominationCourante: string;
    siret: string;
    echeanceSiret: string;
    flag: string;
    numeroBio: string;
    echangeSiret: string;
    email: string;
    gerant: string;
    telephone: string;
    telephoneCommerciale: string;
    numeroPacage: string;
    dateFinConversion: string;
    lat: number;
    long: number;
    mandate: boolean;
    dateMaj: Date;
    dateEngagement: Date;
    datePremierEngagement: Date;
    codeNAF: string;
    reseauId: number;
    departementId: number;
    photo: any[];
    sitesWeb: string[];
    activites: AgenceBioActivity[];
    notifications?: AgenceBioNotification[] | undefined;
    certificats?: AgenceBioCertificate[] | undefined;
    adressesOperateurs?: AgenceBioAdresses[];
};
export type AgenceBioCertificate = {
    organisme: string;
    date: string;
    url: string;
    /**
     * - TODO check it does really exists and otherwise update deriveOrganismeCertificateurFromOperator
     */
    organismeCertificateurId: number;
};
export type AgenceBioNotification = {
    id: number;
    active: boolean;
    dateArret?: string | undefined;
    dateChangementEffet?: string | undefined;
    dateDemarrage?: string | undefined;
    dateFinRetrait?: string | undefined;
    dateFinSuspension?: string | undefined;
    dateHabilitation?: string | undefined;
    dateRetrait?: string | undefined;
    dateSignatureContrat?: string | undefined;
    dateSuspension?: string | undefined;
    dispenseOc: boolean;
    dispenseOcMotif?: string | undefined;
    etatCertification: string;
    motifRefus?: string | undefined;
    motifDelete?: string | undefined;
    operateurId: number;
    organismeCertificateur: OrganismeCertificateur;
    numeroNotification?: string | undefined;
    numeroClient?: string | undefined;
    organisme: string;
    date: string;
    status: string;
    url?: string | undefined;
    activites: AgenceBioActivity[];
    productions: AgenceBioProduction[];
};

/**
 * This is what we output
 */
export type AgenceBioAdresseGeo = {
  codeCommune: string,
  lat: number,
  long: number,
}

/**
 * This is what we consume
 */
export type AgenceBioAdresses = AgenceBioAdresseGeo & {
  active: boolean;
  lieu: string;
  dates: string;
  codePostal: string;
  ville: string
};
/**
 * Only some endpoints provide this data
 */
export type AgenceBioOperatorWithAdresses = AgenceBioOperator & {
    adressesOperateurs: AgenceBioAdresses[];
};
export type AgenceBioActivity = {
    id: number;
    nom: string;
};
export type AgenceBioProduction = {
    id: number;
    nom: string;
    parent: number;
};
export type AgenceBioUserGroup = {
    id: string;
    nom: string;
};
