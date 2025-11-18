import { Feature, FeatureCollection, Polygon } from "geojson";

export type CartoBioFeatureProperties = {
    id?: string | number;
    createdAt?: string;
    updatedAt?: string;
    COMMUNE_LABEL?: string;
    COMMUNE?: string;
    cultures: CartoBioCulture[];
    conversion_niveau: string;
    engagement_date?: string;
    commentaires?: string;
    auditeur_notes?: string;
    annotations?: any;
    NOM?: string;
    PACAGE?: string;
    NUMERO_I?: string;
    NUMERO_P?: string;
    cadastre?: string[];
    etranger?: boolean;
    TYPE?: string;
    CODE_VAR?: string;
    CODE_CULTURE?: string;
    CODE_PRECISION?: string;
    controlee?: boolean;
    historique?: CartoBioHistoriqueCulture[];
    /**
     * @deprecated
     */
    CPF?: string;
    /**
     * @deprecated
     */
    SURF?: number;
    /**
     * @deprecated
     */
    variete?: string;
};
/**
 *  id: 44592208968963,
    BIO: 0,
    CAMPAGNE: 2024,
    COMMUNE: '70421',
    cultures: [ [Object] ],
    conversion_niveau: 'CONV',
    NUMERO_I: '2',
    NUMERO_P: '1',
    PACAGE: '999100540',
    TYPE: 'PTR',
    CODE_VAR: ''

 */
/**
 * Cartobio specific GeoJson definitions
 */
export type CartoBioCulture = {
    id: import("crypto").UUID;
    CPF: string;
    TYPE?: string | undefined;
    variete?: string | undefined;
    /**
     * - La surface en hectares
     */
    surface?: string | number | undefined;
    unit?: "%" | "ha" | undefined;
    date_semis?: string | undefined;
};

export type CartoBioHistoriqueCulture = {
    cultures: CartoBioCulture[];
    annee_controle: number;
    conversion_niveau: string;
};

export type CartoBioFeature = Feature<Polygon, CartoBioFeatureProperties>;
export type CartoBioFeatureCollection = FeatureCollection<
    Polygon,
    CartoBioFeatureProperties
>;
export type CartoBioGeoJson =
    | CartoBioFeatureProperties
    | CartoBioFeature
    | CartoBioFeatureCollection
    | Array<CartoBioGeoJson>;
