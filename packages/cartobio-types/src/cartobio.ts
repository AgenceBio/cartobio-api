import type { CertificationState, EtatProduction } from "./enums.js";
import type {
    CartoBioCulture,
    CartoBioHistoriqueCulture,
} from "./features.js";
import type { HistoryEntry } from "./history.js";
import type { AgenceBioUserGroup, OrganismeCertificateur } from "./agence-bio.js";
import type { Polygon } from "geojson";

/**
 * An operator record as we store it in CartoBio database
 */
export type DBOperatorRecord = {
    record_id: string;
    numerobio: string;
    version_name: string;
    annee_reference_controle: number | null;
    certification_date_debut: string | null;
    certification_date_fin: string | null;
    certification_state: CertificationState;
    created_at: string;
    updated_at: string;
    oc_id: number | null;
    oc_label?: string | null;
    parcelles?: DBParcelle[];
    metadata: Record<string, unknown>;
    audit_history: HistoryEntry[];
    audit_notes: string | null;
    audit_demandes: string | null;
    audit_date: string | null;
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
export type DBParcelle = {
    record_id: string;
    id: string;
    geometry: Polygon;
    commune?: string | null;
    cultures: CartoBioCulture[];
    conversion_niveau: EtatProduction;
    engagement_date?: string | null;
    commentaire?: string | null;
    auditeur_notes?: string | null;
    annotations?: object[] | null; // Replace with actual Annotations type
    created?: string | null;
    updated?: string | null;
    name?: string | null;
    numero_pacage?: string | null;
    numero_ilot_pac?: string | null;
    numero_parcelle_pac?: string | null;
    reference_cadastre?: string[] | null;
    etranger: boolean;
    code_culture_pac?: string | null;
    code_precision_pac?: string | null;
    controlee?: boolean | null;
    historique_cultures?: CartoBioHistoriqueCulture[] | null;
    statut_import_geom?: string | null;
    attente_pac?: boolean | null;
};

export type { OperatorFilterInput as OperatorFilter } from "./contracts/operators.js";
