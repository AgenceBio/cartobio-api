import {OrganismeCertificateur} from "../../providers/types/agence-bio";

export type AgenceBioNormalizedOperator = {
    id: number;
    nom: string;
    denominationCourante: string;
    siret: string;
    numeroBio: string;
    numeroPacage: string;
    email: string;
    dateEngagement: Date;
    datePremierEngagement: Date;
    certificats: any[];
    organismeCertificateur: OrganismeCertificateur | {};
    codeCommune: string;
    departement: string;
    commune: string;
    codePostal: string;
    notifications: any[];
};
