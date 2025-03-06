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

export type AgenceBioNormalizedOperatorWithRecord =
    AgenceBioNormalizedOperator &
        (Partial<NormalizedRecord> & { metadata: any });

export type AgenceBioNormalizedOperatorWithPinnedStatus =
    AgenceBioNormalizedOperator & { epingle: boolean };

export type AgenceBioNormalizedOperatorWithFilterData =
    AgenceBioNormalizedOperator & {
        lastmixitestate?: string;
        states?: {
            certification_state: string;
            annee_reference_controle: number;
        }[];
    };
