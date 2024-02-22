import {EventType} from "../history.js";
import type {CartoBioUser} from "../../providers/types/cartobio.d.ts";

export type HistoryEntry = {
    type: EventType;
    state?: string | undefined;
    date: string;
    metadata?: any | undefined;
    description?: string | undefined;
    user?: CartoBioUser | undefined;
    featureIds?: Array<number> | undefined;
};
