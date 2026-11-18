import type { DBOperatorRecord } from "./cartobio.js";
import type { AgenceBioNormalizedOperator } from "./operator.js";
import type { CartoBioFeatureCollection } from "./features.js";

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
    audit_date?: string | null;
    certification_date_debut?: string | null;
    certification_date_fin?: string | null;
    parcelles: CartoBioFeatureCollection;
    operator?: AgenceBioNormalizedOperator;
    oc_id?: number | null;
    audit_notes?: string | null;
    annee_reference_controle?: number | null;
    certification_state?: string;
    lastmixitestate?: string;
};

export type NormalizedRecordSummary = Omit<NormalizedRecord, "parcelles"> & {
    parcelles: number;
    surface: number;
};
