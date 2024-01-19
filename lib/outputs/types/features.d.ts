import {Feature, FeatureCollection, GeoJsonProperties, Polygon} from "geojson";

export type CartoBioFeatureProperties = GeoJsonProperties & {
    id?: string|number;
    createdAt?: string;
    updatedAt?: string;
    COMMUNE_LABEL?: string;
    COMMUNE?: string;
    cultures: CartobioCulture[];
    conversion_niveau: string;
    engagement_date: string;
    commentaire?: string;
    annotations?: any;
    NOM?: string;
    PACAGE?: string;
    NUMERO_I?: string;
    NUMERO_P?: string;
    cadastre?: string[];
    /**
     * @deprecated
     */
    CPF?: string;
    /**
     * @deprecated
     */
    TYPE?: string;
    /**
     * @deprecated
     */
    variete?: string;
};
/**
 * Cartobio specific GeoJson definitions
 */
export type CartobioCulture = {
    id: import('crypto').UUID;
    CPF: string;
    TYPE?: string | undefined;
    variete?: string | undefined;
    /**
     * - La surface en hectares
     */
    surface?: string | number | undefined;
    unit?: string | undefined;
    date_semis?: string | undefined;
};
export type CartoBioFeature = Feature<Polygon, CartoBioFeatureProperties>;
export type CartoBioFeatureCollection = FeatureCollection<Polygon, CartoBioFeatureProperties>;
export type CartoBioGeoJson = CartoBioFeatureProperties | CartoBioFeature | CartoBioFeatureCollection | Array<CartoBioGeoJson>;
