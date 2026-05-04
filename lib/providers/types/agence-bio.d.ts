/****
 * Types which depends on the Agence Bio API
 */

export type OrganismeCertificateur = {
    id: number;
    nom: string;
    numeroControleEu?: string | undefined;
    numeroClient?: string | undefined;
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
    notifications?: AgenceBioNotification[] | undefined;
    adressesOperateurs?: AgenceBioAdresses[];
};

export type AgenceBioNotification = {
    id: number;
    dateArret?: string | undefined;
    dateDemarrage?: string | undefined;
    etatCertification: string;
    numeroClient?: string | undefined;
    status: string;
    organismeCertificateurId: number | null;
    organisme: string | null;
    activites: AgenceBioActivity[] | null;
};

/**
 * This is what we output
 */
export type AgenceBioAdresseGeo = {
    codeCommune: string;
    lat: number;
    long: number;
};

/**
 * This is what we consume
 */
export type AgenceBioAdresses = AgenceBioAdresseGeo & {
    active: boolean;
    lieu: string;
    dates: string;
    codePostal: string;
    ville: string;
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
