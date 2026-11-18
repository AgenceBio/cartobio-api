import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { FeaturePropertiesInput } from "./contracts/audits.js";

export type CartoBioFeatureProperties = {
    id?: string | number;
    createdAt?: string | null;
    updatedAt?: string | null;
    COMMUNE_LABEL?: string;
    COMMUNE?: string | null;
    cultures: CartoBioCulture[];
    conversion_niveau: string;
    engagement_date?: string | null;
    commentaires?: string | null;
    auditeur_notes?: string | null;
    annotations?: object[] | null;
    NOM?: string | null;
    PACAGE?: string | null;
    NUMERO_I?: string | number | null;
    NUMERO_P?: string | number | null;
    cadastre?: string[] | null;
    etranger?: boolean;
    statut_import_geom?: string | null;
    TYPE?: string | null;
    CODE_VAR?: string | null;
    CODE_CULTURE?: string | null;
    CODE_PRECISION?: string | null;
    controlee?: boolean;
    historique?: CartoBioHistoriqueCulture[] | null;
    attente_pac?: boolean;
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
    id: `${string}-${string}-${string}-${string}-${string}`;
    CPF: string | undefined;
    TYPE?: string | null;
    variete?: string | null;
    /**
     * - La surface en hectares
     */
    surface?: string | number | null;
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
export type CartoBioFeatureInput = Feature<Polygon | null, FeaturePropertiesInput>;
export type CartoBioFeatureCollectionInput = FeatureCollection<
    Polygon | null,
    FeaturePropertiesInput
>;
export type CartoBioGeoJson =
    | CartoBioFeatureProperties
    | CartoBioFeature
    | CartoBioFeatureCollection
    | Array<CartoBioGeoJson>;
