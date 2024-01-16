import {DBOperatorRecord} from "../../providers/types/cartobio";
import {AgenceBioNormalizedOperator} from "./operator";

/**
 * A database record normalized to be used in Cartobio, with operator data from Agence Bio
 */
export type NormalizedRecord = DBOperatorRecord & {
    operator?: AgenceBioNormalizedOperator;
};
