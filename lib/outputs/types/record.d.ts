import type { DBOperatorRecord } from "../../providers/types/cartobio.d.ts";
import type { AgenceBioNormalizedOperator } from "./operator.d.ts";
import type { CartoBioFeatureCollection } from "./features.d.ts";

/**
 * A database record normalized to be used in Cartobio, with operator data from Agence Bio
 */
export type NormalizedRecord = Omit<
    DBOperatorRecord,
    | "parcelles"
    | "audit_date"
    | "certification_date_debut"
    | "certification_date_fin"
    | "oc_id"
    | "audit_notes"
> & {
    audit_date?: string;
    certification_date_debut?: string;
    certification_date_fin?: string;
    parcelles: CartoBioFeatureCollection;
    operator?: AgenceBioNormalizedOperator;
    oc_id?: number;
    audit_notes?: string;
    annee_reference_controle?: number;
    certification_state?: string;
    lastmixitestate?: string;
    states?: {
        certification_state: string;
        annee_reference_controle: number;
    }[];
};

export type NormalizedRecordSummary = Omit<NormalizedRecord, "parcelles"> & {
    parcelles: number;
    surface: number;
};
