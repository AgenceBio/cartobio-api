import {EtatProduction,CertificationState} from "../record";
import {Feature, FeatureCollection, Polygon} from "geojson";

export type InputApiRecord = {
    numeroBio: number | string;
    numeroClient: number | string;
    anneeReferenceControle: number;
    anneeAssolement: number;
    dateAudit: string;
    numeroPacage: number | string;
    parcelles: InputApiParcelle[];
};
export type InputApiParcelle = {
    id: number | string;
    dateEngagement: string;
    etatProduction: EtatProduction;
    numeroIlot?: string | undefined;
    numeroParcelle?: string | undefined;
    commentaire?: string | undefined;
    geom: string;
    culture: InputApiCulture[];
    cultures?: InputApiCulture[] | undefined;
};
export type InputApiCulture = {
    codeCPF: string;
    variete?: string | undefined;
    quantite: number | string;
};


export type OutputApiRecord = {
    numeroBio: string;
    certification: OutputApiCertification;
    parcellaire: OutputApiFeatureCollection;
};

export type OutputApiCertification = {
    statut: CertificationState;
    dateDebut: string;
    dateFin: string;
    demandesAudit: string;
    notesAudit: string;
};

export type OutputApiCulture = {
    cpf: string;
    surface?: number;
    unite?: 'ha' | '%';
    variete?: string;
    dateSemis?: string;
}

export type OutputApiFeatureProperties = {
    id: string;
    commune: string;
    cultures: OutputApiCulture[];
    surface: number;
    niveauConversion: EtatProduction;
    dateEngagement: string;
    commentaire: string;
    annotations: any;
    dateAjout?: string;
    dateMiseAJour?: string;
    nom?: string;
    numeroPacage?: string;
    numeroIlotPAC?: string;
    numeroParcellePAC?: string;
    referenceCadastrale?: string;
};

export type OutputApiFeatureCollection = FeatureCollection<Polygon, OutputApiFeatureProperties>;
export type OutputApiParcelle = Feature<Polygon, OutputApiFeatureProperties>;
