import {OrganismeCertificateur} from "../../providers/types/agence-bio";
import {NormalizedRecord} from "./record";

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

// TODO : this is a bit of duplicate with NormalizedRecord
//  (we should not have to different objects for sending operator + record)
export type AgenceBioNormalizedOperatorWithRecord = AgenceBioNormalizedOperator & (NormalizedRecord | { metadata: any })
