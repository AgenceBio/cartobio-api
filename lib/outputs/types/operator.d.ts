import type {
    AgenceBioAdresseGeo,
    OrganismeCertificateur,
} from "../../providers/types/agence-bio.d.ts";
import type { NormalizedRecord } from "./record.d.ts";

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
    organismeCertificateur: OrganismeCertificateur | {};
    adressesOperateurs: AgenceBioAdresseGeo[];
    codeCommune: string;
    departement: string;
    commune: string;
    codePostal: string;
    notifications: any;
    isProduction: boolean;
};

// TODO : this is a bit of duplicate with NormalizedRecord
//  (we should not have to different objects for sending operator + record)
export type AgenceBioNormalizedOperatorWithRecord =
    AgenceBioNormalizedOperator & (NormalizedRecord & { metadata: any });

export type AgenceBioNormalizedOperatorWithPinnedStatus =
    AgenceBioNormalizedOperator & { epingle: boolean };
