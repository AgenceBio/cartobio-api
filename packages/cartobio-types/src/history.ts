import type { EventType } from "./enums.js";
import type {CartoBioUser} from "./cartobio.js";

export type HistoryEntry = {
    type: EventType;
    state?: string | undefined;
    date: string;
    metadata?: Record<string, unknown> | undefined;
    description?: string | undefined;
    user?: CartoBioUser | undefined;
    featureIds?: Array<string | number | undefined> | null | undefined;
};
