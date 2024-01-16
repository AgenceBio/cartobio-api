import {EtatProduction} from "../../outputs/record";
import {CartoBioFeatureCollection} from "../../outputs/types/features";
import {HistoryEntry} from "../../outputs/types/history";
import {AgenceBioUserGroup, OrganismeCertificateur} from "./agence-bio";

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
    parcelles: CartoBioFeatureCollection;
    metadata: any;
    audit_history: HistoryEntry[];
    audit_notes: string;
    audit_demandes: string;
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

