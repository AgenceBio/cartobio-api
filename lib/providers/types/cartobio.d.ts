import { CertificationState, EtatProduction } from "../../enums";
import { CartoBioCulture } from "../../outputs/types/features";
import { HistoryEntry } from "../../outputs/types/history";
import { AgenceBioUserGroup, OrganismeCertificateur } from "./agence-bio";
import { Polygon } from "geojson";

/**
 * An operator record as we store it in CartoBio database
 */
export type DBOperatorRecord = {
    record_id: number;
    numerobio: string;
    version_name: string;
    annee_reference_controle: number | null;
    certification_date_debut: string;
    certification_date_fin: string;
    certification_state: CertificationState;
    created_at: string;
    updated_at: string;
    oc_id: number;
    oc_label: string;
    parcelles?: DBParcelle[];
    metadata: any;
    audit_history: HistoryEntry[];
    audit_notes: string;
    audit_demandes: string;
    audit_date: string;
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
    cultures: CartoBioCulture[];
    conversion_niveau: EtatProduction;
    engagement_date?: string;
    commentaire?: string;
    auditeur_notes?: string;
    annotations?: object[]; // Replace with actual Annotations type
    created?: string;
    updated?: string;
    name?: string;
    numero_pacage?: string;
    numero_ilot_pac?: string;
    numero_parcelle_pac?: string;
    reference_cadastre?: string[];
    etranger: boolean;
    code_culture_pac?: string;
    code_precision_pac?: string;
};

export type OperatorFilter = {
    departement?: string[] | null;
    engagement?: string | null;
    pinned?: boolean | null;
    etatCertification?: string | null;
    anneeReferenceCertification?: number | null;
    etatNotification?: string[] | null;
    statutParcellaire?: string[] | null;
};
