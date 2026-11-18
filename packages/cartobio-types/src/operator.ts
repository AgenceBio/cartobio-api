import type {
    AgenceBioAdresseGeo,
    AgenceBioAdresses,
    AgenceBioNotification,
    OrganismeCertificateur,
} from "./agence-bio.js";
import type { NormalizedRecord } from "./record.js";

export type AgenceBioNormalizedOperator = {
    id: number;
    nom: string;
    denominationCourante: string;
    siret: string;
    numeroBio: string;
    numeroPacage: string | null;
    email: string;
    dateEngagement: Date;
    datePremierEngagement: Date;
    organismeCertificateur: OrganismeCertificateur | Record<string, never>;
    adressesOperateurs: (AgenceBioAdresseGeo & Pick<AgenceBioAdresses, 'lieu' | 'codePostal' | 'ville'>)[];
    codeCommune: string;
    departement: string;
    commune: string;
    codePostal: string;
    notifications: AgenceBioNotification | null;
    isProduction: boolean;
};

export type AgenceBioNormalizedOperatorWithRecord =
    AgenceBioNormalizedOperator &
        (Partial<NormalizedRecord> & { metadata: Record<string, unknown> });

export type AgenceBioNormalizedOperatorWithPinnedStatus =
    AgenceBioNormalizedOperator & { epingle: boolean };

export type AgenceBioNormalizedOperatorWithFilterData =
    AgenceBioNormalizedOperator & {
        lastmixitestate?: string;
        states?: {
            certification_state: string;
            annee_reference_controle: number;
        }[];
        list_oc_id?: number[];
        max_audit_date?: Date | null;
        metadata?: Record<string, unknown>;
    };
