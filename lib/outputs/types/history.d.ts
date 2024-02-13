import {EventType} from "../history";
import {CartoBioUser} from "../../providers/types/cartobio";

export type HistoryEntry = {
    type: EventType;
    state?: string | undefined;
    date: string;
    metadata?: any | undefined;
    description?: string | undefined;
    user?: CartoBioUser | undefined;
    featureIds?: Array<number> | undefined;
};
