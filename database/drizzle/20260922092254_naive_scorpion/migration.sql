CREATE TYPE "annotation_type" AS ENUM('DOWNGRADED', 'METADATA_STATE', 'REDUCED_CONVERSION_PERIOD', 'RISKY', 'SAMPLED', 'SURVEYED');--> statement-breakpoint
CREATE TYPE "certification_type" AS ENUM('OPERATOR_DRAFT', 'AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED');--> statement-breakpoint
CREATE TYPE "conversion_niveau" AS ENUM('AB', 'AB?', 'C1', 'C2', 'C3', 'CONV');--> statement-breakpoint
CREATE TYPE "import_log_type" AS ENUM('warning', 'error');--> statement-breakpoint
CREATE TYPE "import_status" AS ENUM('DONE', 'CREATED', 'ERROR');--> statement-breakpoint
CREATE TYPE "mixite_type" AS ENUM('MIXTE', 'AB', 'ABCONV');--> statement-breakpoint
CREATE TYPE "parcellaire_event_type" AS ENUM('CERTIFICATION_STATE_CHANGE', 'FEATURE_COLLECTION_CREATE', 'FEATURE_COLLECTION_DELETE', 'FEATURE_COLLECTION_UPDATE', 'FEATURE_CREATE', 'FEATURE_DELETE', 'FEATURE_UPDATE');--> statement-breakpoint
CREATE TYPE "production_attestation_status" AS ENUM('generated', 'error');--> statement-breakpoint
CREATE TYPE "production_attestation_type" AS ENUM('complete', 'pac-details', 'pac-complet');--> statement-breakpoint
CREATE TYPE "statut_import_geom" AS ENUM('ACCEPTE', 'CORRIGE', 'ACCEPTE_NON_CORRIGE');--> statement-breakpoint
CREATE TABLE "organisme_certificateur" (
	"id" varchar(64) PRIMARY KEY,
	"label" text NOT NULL,
	"email" text[],
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communes" (
	"fid" varchar(5) PRIMARY KEY,
	"geometry" geometry(point,4326) NOT NULL,
	"nom" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departements" (
	"fid" varchar(10) PRIMARY KEY,
	"geometry" geometry(point,4326) NOT NULL,
	"nom" varchar(255) NOT NULL,
	"code_region" varchar(10) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"code" varchar(10) PRIMARY KEY,
	"geometry" geometry(point,4326) NOT NULL,
	"nom" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territoires" (
	"fid" varchar(64) PRIMARY KEY,
	"geom" geometry(point,4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcellaires" (
	"record_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"numerobio" integer NOT NULL,
	"oc_id" varchar(64) NOT NULL,
	"certification_etat" "certification_type" NOT NULL,
	"certification_date_debut" date,
	"certification_date_fin" date,
	"audit_date" date,
	"annee_reference_controle" smallint NOT NULL,
	"audit_notes_certif" text,
	"audit_demandes_operateur" text,
	"version_nom" text NOT NULL,
	"mixite" "mixite_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parcellaires_evenements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"record_id" uuid NOT NULL,
	"type" "parcellaire_event_type" NOT NULL,
	"certification_etat" "certification_type" NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"user" jsonb NOT NULL,
	"parcelles_id" text[]
);
--> statement-breakpoint
CREATE TABLE "parcellaires_metadata" (
	"record_id" uuid PRIMARY KEY,
	"source" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"provenance" text NOT NULL,
	"campagne" smallint,
	"numero_pacage" text,
	"annee_assolement" smallint
);
--> statement-breakpoint
CREATE TABLE "parcelle_cultures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"record_id" uuid NOT NULL,
	"parcelle_id" text NOT NULL,
	"cpf" varchar(64) NOT NULL,
	"code_culture_import" varchar(64),
	"surface" numeric(12,4),
	"unit" varchar(20),
	"variete" varchar(255),
	"date_semis" date
);
--> statement-breakpoint
CREATE TABLE "parcelles" (
	"id" text,
	"record_id" uuid,
	"commune" varchar(5),
	"geometry" geometry(point,4326) NOT NULL,
	"surface_ha" numeric(12,4) NOT NULL,
	"conversion_niveau" "conversion_niveau",
	"engagement_date" date,
	"commentaire_operateur" text,
	"auditeur_notes_parcelles" text,
	"from_parcelles" text[],
	"name" text,
	"numero_pacage" smallint,
	"numero_ilot_pac" smallint,
	"numero_parcelles_pac" smallint,
	"reference_cadastre" text[],
	"code_culture_pac" varchar,
	"code_precision_pac" varchar,
	"etranger" boolean DEFAULT false NOT NULL,
	"statut_import_geom" "statut_import_geom",
	"attente_pac" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "parcelles_pkey" PRIMARY KEY("record_id","id")
);
--> statement-breakpoint
CREATE TABLE "parcelles_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"parcelle_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"type_annot" "annotation_type" NOT NULL,
	"created_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attestations_production" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"record_id" uuid NOT NULL,
	"path" varchar(1024),
	"status" "production_attestation_status" NOT NULL,
	"type" "production_attestation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcellaires_consultes" (
	"record_id" uuid,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcellaires_consultes_pkey" PRIMARY KEY("record_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "parcellaires_epingles" (
	"record_id" uuid,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcellaires_epingles_pkey" PRIMARY KEY("record_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "parcelles_controles" (
	"record_id" uuid,
	"parcelle_id" text,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcelles_controles_pkey" PRIMARY KEY("record_id","parcelle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "import_pac" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"numerobio" varchar,
	"pacage" varchar,
	"siret" varchar(14),
	"nb_parcelles" varchar(20),
	"size" varchar,
	"record" jsonb,
	"imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcellaire_import_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"import_id" varchar(64) NOT NULL,
	"type" "import_log_type" NOT NULL,
	"message" varchar NOT NULL,
	"numero_bio" varchar NOT NULL,
	"code" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcellaire_import_payload" (
	"id" varchar PRIMARY KEY,
	"import_id" varchar NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "parcellaires_import" (
	"id" varchar(64) PRIMARY KEY,
	"status" "import_status" DEFAULT 'CREATED'::"import_status" NOT NULL,
	"organisme_certificateur" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"numerobio" varchar,
	"numeroclient" varchar,
	"audit_date" timestamp,
	"result_job" jsonb
);
--> statement-breakpoint
CREATE TABLE "revoked_tokens" (
	"token_hash" varchar PRIMARY KEY,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "communes_geometry_gix" ON "communes" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "departements_geometry_gix" ON "departements" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "regions_geometry_gix" ON "regions" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "territoires_geometry_gix" ON "territoires" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "parcellaires_numerobio_idx" ON "parcellaires" ("numerobio");--> statement-breakpoint
CREATE INDEX "parcellaires_oc_id_idx" ON "parcellaires" ("oc_id");--> statement-breakpoint
CREATE INDEX "parcellaires_evenements_record_id_idx" ON "parcellaires_evenements" ("record_id");--> statement-breakpoint
CREATE INDEX "parcelle_cultures_record_id_idx" ON "parcelle_cultures" ("record_id");--> statement-breakpoint
CREATE INDEX "parcelle_cultures_parcelle_id_idx" ON "parcelle_cultures" ("parcelle_id");--> statement-breakpoint
CREATE INDEX "parcelle_cultures_cpf_idx" ON "parcelle_cultures" ("cpf");--> statement-breakpoint
CREATE INDEX "parcelles_record_id_idx" ON "parcelles" ("record_id");--> statement-breakpoint
CREATE INDEX "parcelles_commune_idx" ON "parcelles" ("commune");--> statement-breakpoint
CREATE INDEX "parcelles_geometry_gix" ON "parcelles" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "parcelles_annotations_parcelle_id_idx" ON "parcelles_annotations" ("parcelle_id");--> statement-breakpoint
CREATE INDEX "parcelles_annotations_record_id_idx" ON "parcelles_annotations" ("record_id");--> statement-breakpoint
CREATE INDEX "attestations_production_record_id_idx" ON "attestations_production" ("record_id");--> statement-breakpoint
CREATE INDEX "parcellaire_import_logs_import_id_idx" ON "parcellaire_import_logs" ("import_id");--> statement-breakpoint
CREATE INDEX "revoked_tokens_expires_at_idx" ON "revoked_tokens" ("expires_at");--> statement-breakpoint
ALTER TABLE "departements" ADD CONSTRAINT "departements_code_region_regions_code_fkey" FOREIGN KEY ("code_region") REFERENCES "regions"("code");--> statement-breakpoint
ALTER TABLE "parcellaires" ADD CONSTRAINT "parcellaires_oc_id_organisme_certificateur_id_fkey" FOREIGN KEY ("oc_id") REFERENCES "organisme_certificateur"("id");--> statement-breakpoint
ALTER TABLE "parcellaires_evenements" ADD CONSTRAINT "parcellaires_evenements_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcellaires_metadata" ADD CONSTRAINT "parcellaires_metadata_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcelle_cultures" ADD CONSTRAINT "parcelle_cultures_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcelle_cultures" ADD CONSTRAINT "parcelle_cultures_parcelle_id_parcelles_id_fkey" FOREIGN KEY ("parcelle_id") REFERENCES "parcelles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcelles" ADD CONSTRAINT "parcelles_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcelles" ADD CONSTRAINT "parcelles_commune_communes_fid_fkey" FOREIGN KEY ("commune") REFERENCES "communes"("fid");--> statement-breakpoint
ALTER TABLE "parcelles_annotations" ADD CONSTRAINT "parcelles_annotations_parcelle_id_parcelles_id_fkey" FOREIGN KEY ("parcelle_id") REFERENCES "parcelles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcelles_annotations" ADD CONSTRAINT "parcelles_annotations_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attestations_production" ADD CONSTRAINT "attestations_production_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcellaires_consultes" ADD CONSTRAINT "parcellaires_consultes_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcellaires_epingles" ADD CONSTRAINT "parcellaires_epingles_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcelles_controles" ADD CONSTRAINT "parcelles_controles_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcelles_controles" ADD CONSTRAINT "parcelles_controles_parcelle_id_parcelles_id_fkey" FOREIGN KEY ("parcelle_id") REFERENCES "parcelles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcellaire_import_logs" ADD CONSTRAINT "parcellaire_import_logs_import_id_parcellaires_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "parcellaires_import"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "parcellaire_import_payload" ADD CONSTRAINT "parcellaire_import_payload_QzYBWqSykZMj_fkey" FOREIGN KEY ("import_id") REFERENCES "parcellaires_import"("id") ON DELETE CASCADE;