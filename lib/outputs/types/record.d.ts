import type {DBOperatorRecord} from "../../providers/types/cartobio.d.ts";
import type {AgenceBioNormalizedOperator} from "./operator.d.ts";
import type {CartoBioFeatureCollection} from "./features.d.ts";

/**
 * A database record normalized to be used in Cartobio, with operator data from Agence Bio
 */
export type NormalizedRecord = Omit<
    DBOperatorRecord,
    'parcelles' | 'audit_date' | 'certification_date_debut' | 'certification_date_fin'
> & {
    audit_date?: string;
    certification_date_debut?: string;
    certification_date_fin?: string;
    parcelles: CartoBioFeatureCollection ;
    operator?: AgenceBioNormalizedOperator;
};

export type NormalizedRecordSummary = Omit<NormalizedRecord, 'parcelles'> & {
    parcelles: number,
    surface: number
};
