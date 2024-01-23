import {DBOperatorRecord} from "../../providers/types/cartobio";
import {AgenceBioNormalizedOperator} from "./operator";
import {CartoBioFeatureCollection} from "./features";

/**
 * A database record normalized to be used in Cartobio, with operator data from Agence Bio
 */
export type NormalizedRecord = Omit<DBOperatorRecord, 'parcelles'> & {
    parcelles: CartoBioFeatureCollection;
    operator: AgenceBioNormalizedOperator;
};

