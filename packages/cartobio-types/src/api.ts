import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { CertificationState, EtatProduction } from "./enums.js";

export type InputApiRecord = {
    numeroBio: number | string;
    numeroClient: number | string;
    anneeReferenceControle: number;
    anneeAssolement: number;
    commentaire?: string;
    dateAudit: string;
    dateCertificationDebut?: string;
    dateCertificationFin?: string;
    numeroPacage: number | string;
    parcelles: InputApiParcelle[];
};
export type InputApiParcelle = {
    id: number | string;
    dateEngagement: string;
    etatProduction: EtatProduction;
    numeroIlot?: string | undefined;
    commune?: string | undefined;
    nom?: string | undefined;
    numeroParcelle?: string | undefined;
    commentaire?: string | undefined;
    codeCulture?: string | undefined;
    codePrecision?: string | undefined;
    geom: string;
    culture: InputApiCulture[];
    cultures?: InputApiCulture[] | undefined;
    enAttentePac?:boolean | number | undefined;
};
export type InputApiCulture = {
    codeCPF: string;
    dateSemis?: string | undefined;
    variete?: string | undefined;
    quantite: number | string;
    unite?: "ha" | "%";
};

export type OutputApiRecord = {
    numeroBio: string;
    version_name: string;
    certification: OutputApiCertification;
    parcellaire: OutputApiFeatureCollection;
};

export type OutputApiCertification = {
    statut?: CertificationState;
    dateAudit?: string | null;
    dateDebut?: string | null;
    dateFin?: string | null;
    demandesAudit?: string | null;
    notesAudit?: string | null;
    anneeReferenceControle: number | null;
};

export type OutputApiCulture = {
    cpf: string | undefined;
    surface?: number | null;
    unite?: "ha" | "%";
    variete?: string | null;
    dateSemis?: string;
};

export type OutputApiFeatureProperties = {
    id: string;
    commune?: string | null;
    cultures: OutputApiCulture[];
    surface: number;
    niveauConversion?: EtatProduction | null;
    dateEngagement?: string | null;
    commentaire?: string | null;
    annotations?: object[] | null;
    dateAjout?: string | null;
    dateMiseAJour?: string | null;
    nom?: string | null;
    numeroPacage?: string | null;
    numeroIlotPAC?: string | number | null;
    numeroParcellePAC?: string | number | null;
    referenceCadastrale?: string | null;
};

export type OutputApiFeatureCollection = FeatureCollection<
    Polygon,
    OutputApiFeatureProperties
>;
export type OutputApiParcelle = Feature<Polygon, OutputApiFeatureProperties>;
