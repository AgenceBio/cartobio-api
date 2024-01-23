import {EtatProduction} from "../../outputs/record";
import {CartobioCulture} from "../../outputs/types/features";
import {HistoryEntry} from "../../outputs/types/history";
import {AgenceBioUserGroup, OrganismeCertificateur} from "./agence-bio";
import {Polygon} from "geojson";

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

/**
 * An operator record as we store it in CartoBio database
 */
export type DBOperatorRecord = {
    record_id: number;
    numerobio: string;
    certification_date_debut: string;
    certification_date_fin: string;
    certification_state: string;
    created_at: string;
    updated_at: string;
    parcelles?: DBParcelle[];
    metadata: any;
    audit_history: HistoryEntry[];
    audit_notes: string;
    audit_demandes: string;
};
export type DBOperatorRecordWithParcelles = DBOperatorRecord & {
    parcelles: DBParcelle[];
};
export type CartoBioUser = {
    id: number;
    nom: string;
    prenom: string;
    /**
     * - this is the part where we still rely on Agence Bio abstractions
     */
    groups: AgenceBioUserGroup[];
    mainGroup: AgenceBioUserGroup;
};
export type CartoBioOCUser = CartoBioUser & {
    organismeCertificateur: OrganismeCertificateur;
};
type DBParcelle = {
    record_id: string;
    id: string;
    geometry: Polygon;
    commune?: string;
    cultures: CartobioCulture[];
    conversion_niveau: EtatProduction;
    engagement_date?: string;
    commentaire?: string;
    annotations?: object[]; // Replace with actual Annotations type
    created?: string;
    updated?: string;
    name?: string;
    numero_pacage?: string;
    numero_ilot_pac?: string;
    numero_parcelle_pac?: string;
    reference_cadastre?: string[];
};
