CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE SCHEMA "cartobio";
--> statement-breakpoint
CREATE TYPE "cartobio"."annotation_type" AS ENUM('DOWNGRADED', 'METADATA_STATE', 'REDUCED_CONVERSION_PERIOD', 'RISKY', 'SAMPLED', 'SURVEYED');--> statement-breakpoint
CREATE TYPE "cartobio"."certification_type" AS ENUM('OPERATOR_DRAFT', 'AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED');--> statement-breakpoint
CREATE TYPE "cartobio"."conversion_niveau" AS ENUM('AB', 'AB?', 'C1', 'C2', 'C3', 'CONV');--> statement-breakpoint
CREATE TYPE "cartobio"."import_job_etat" AS ENUM('UNKNOWN', 'UPDATED', 'CREATED');--> statement-breakpoint
CREATE TYPE "cartobio"."import_job_result" AS ENUM('REJECTED', 'VALID', 'ERROR');--> statement-breakpoint
CREATE TYPE "cartobio"."import_log_type" AS ENUM('warning', 'error');--> statement-breakpoint
CREATE TYPE "cartobio"."import_status" AS ENUM('DONE', 'CREATED', 'ERROR', 'PENDING');--> statement-breakpoint
CREATE TYPE "cartobio"."metadata_source" AS ENUM('TELEPAC', 'API_PARCELLAIRE', 'ANYGEO', 'GEOFOLIA', 'MES_PARCELLES', 'CVI', 'RPG', 'MANUEL', 'COPIE_VERSION', 'COPIE_CONFLIT');--> statement-breakpoint
CREATE TYPE "cartobio"."mixite_type" AS ENUM('MIXTE', 'AB', 'ABCONV');--> statement-breakpoint
CREATE TYPE "cartobio"."parcellaire_event_type" AS ENUM('CERTIFICATION_STATE_CHANGE', 'FEATURE_COLLECTION_CREATE', 'FEATURE_COLLECTION_DELETE', 'FEATURE_COLLECTION_UPDATE', 'FEATURE_CREATE', 'FEATURE_DELETE', 'FEATURE_UPDATE');--> statement-breakpoint
CREATE TYPE "cartobio"."production_attestation_status" AS ENUM('started', 'generated', 'error');--> statement-breakpoint
CREATE TYPE "cartobio"."production_attestation_type" AS ENUM('complete', 'pac-details', 'pac-complet');--> statement-breakpoint
CREATE TYPE "cartobio"."statut_import_geom" AS ENUM('ACCEPTE', 'CORRIGE', 'ACCEPTE_NON_CORRIGE');--> statement-breakpoint
CREATE TABLE "cartobio"."organisme_certificateur" (
	"id" integer PRIMARY KEY,
	"label" text NOT NULL,
	"email" text[],
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."communes" (
	"fid" varchar(5) PRIMARY KEY,
	"geometry" geometry(MultiPolygon,4326) NOT NULL,
	"nom" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."departements" (
	"fid" varchar(10) PRIMARY KEY,
	"geometry" geometry(MultiPolygon,4326) NOT NULL,
	"nom" varchar(255) NOT NULL,
	"code_region" varchar(10) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."regions" (
	"code" varchar(10) PRIMARY KEY,
	"geometry" geometry(MultiPolygon,4326) NOT NULL,
	"nom" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."territoires" (
	"fid" varchar(64) PRIMARY KEY,
	"geometry" geometry(MultiPolygon,4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcellaires" (
	"record_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"numero_bio" integer NOT NULL,
	"oc_id" integer,
	"numero_client" varchar,
	"certification_etat" "cartobio"."certification_type" NOT NULL,
	"certification_date_debut" date,
	"certification_date_fin" date,
	"audit_date" date,
	"annee_reference_controle" smallint NOT NULL,
	"audit_notes_certif" text,
	"audit_demandes_operateur" text,
	"version_nom" text NOT NULL,
	"mixite" "cartobio"."mixite_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date_derniere_notif" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcellaires_evenements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"record_id" uuid NOT NULL,
	"type" "cartobio"."parcellaire_event_type" NOT NULL,
	"certification_etat" "cartobio"."certification_type",
	"date" timestamp with time zone NOT NULL,
	"description" text,
	"metadata" jsonb,
	"user_id" varchar(255),
	"user_role" text,
	"parcelles_id" text[]
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcellaires_metadata" (
	"record_id" uuid PRIMARY KEY,
	"source" "cartobio"."metadata_source",
	"source_updated_at" timestamp with time zone,
	"provenance" text,
	"campagne" smallint,
	"numero_pacage" text,
	"annee_assolement" smallint,
	"copy_of" text,
	"warnings" jsonb
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcelle_cultures" (
	"id" text,
	"record_id" uuid,
	"parcelle_id" text,
	"cpf" varchar(64),
	"code_culture_import" varchar(64),
	"surface" numeric(12,4),
	"unit" varchar(20),
	"variete" varchar(255),
	"date_semis" date,
	"commentaire" text,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "parcelle_cultures_pkey" PRIMARY KEY("record_id","parcelle_id","id")
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcelles" (
	"id" text,
	"record_id" uuid,
	"commune" varchar(5),
	"geometry" geometry(Polygon,4326) NOT NULL,
	"surface_ha" numeric(12,4) NOT NULL,
	"conversion_niveau" "cartobio"."conversion_niveau",
	"engagement_date" date,
	"commentaire_operateur" text,
	"auditeur_notes_parcelles" text,
	"from_parcelles" text[],
	"name" text,
	"numero_pacage" varchar(9),
	"numero_ilot_pac" smallint,
	"numero_parcelles_pac" smallint,
	"reference_cadastre" text[],
	"code_culture_pac" varchar,
	"code_precision_pac" varchar,
	"etranger" boolean DEFAULT false NOT NULL,
	"statut_import_geom" "cartobio"."statut_import_geom",
	"attente_pac" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "parcelles_pkey" PRIMARY KEY("record_id","id")
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcelles_annotations" (
	"id" uuid DEFAULT gen_random_uuid(),
	"parcelle_id" text,
	"record_id" uuid,
	"type_annot" "cartobio"."annotation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "parcelles_annotations_pkey" PRIMARY KEY("record_id","parcelle_id","id")
);
--> statement-breakpoint
CREATE TABLE "cartobio"."attestations_production" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"record_id" uuid NOT NULL,
	"path" varchar(1024),
	"status" "cartobio"."production_attestation_status" NOT NULL,
	"type" "cartobio"."production_attestation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."operateurs_consultes" (
	"numero_bio" integer,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operateurs_consultes_pkey" PRIMARY KEY("numero_bio","user_id")
);
--> statement-breakpoint
CREATE TABLE "cartobio"."operateurs_epingles" (
	"numero_bio" integer,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operateurs_epingles_pkey" PRIMARY KEY("numero_bio","user_id")
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcelles_controles" (
	"record_id" uuid,
	"parcelle_id" text,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcelles_controles_pkey" PRIMARY KEY("record_id","parcelle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cartobio"."import_pac" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"numero_bio" varchar,
	"pacage" varchar,
	"siret" varchar(14),
	"nb_parcelles" integer,
	"size" numeric,
	"record" jsonb,
	"imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcellaire_import" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "cartobio"."parcellaire_import_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" "cartobio"."import_status" DEFAULT 'CREATED'::"cartobio"."import_status" NOT NULL,
	"organisme_certificateur" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"numero_bio" varchar,
	"numero_client" varchar,
	"audit_date" date,
	"result_job" jsonb,
	"statut_job" "cartobio"."import_job_result",
	"etat" "cartobio"."import_job_etat" DEFAULT 'UNKNOWN'::"cartobio"."import_job_etat" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcellaire_import_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"import_id" integer NOT NULL,
	"type" "cartobio"."import_log_type" NOT NULL,
	"message" varchar NOT NULL,
	"numero_bio" varchar,
	"parcelle_id" varchar,
	"parcelle_name" varchar,
	"code" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartobio"."parcellaire_import_payload" (
	"id" varchar PRIMARY KEY,
	"import_id" integer NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "cartobio"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" integer NOT NULL,
	"token_hash" varchar NOT NULL UNIQUE,
	"previous_token_hash" varchar UNIQUE,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "communes_geometry_gix" ON "cartobio"."communes" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "departements_geometry_gix" ON "cartobio"."departements" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "regions_geometry_gix" ON "cartobio"."regions" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "territoires_geometry_gix" ON "cartobio"."territoires" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "parcellaires_numero_bio_idx" ON "cartobio"."parcellaires" ("numero_bio");--> statement-breakpoint
CREATE INDEX "parcellaires_oc_id_idx" ON "cartobio"."parcellaires" ("oc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parcellaires_numero_bio_audit_date_idx" ON "cartobio"."parcellaires" ("numero_bio","audit_date") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "parcellaires_evenements_record_id_date_idx" ON "cartobio"."parcellaires_evenements" ("record_id","date");--> statement-breakpoint
CREATE INDEX "parcelle_cultures_parcelle_id_idx" ON "cartobio"."parcelle_cultures" ("parcelle_id");--> statement-breakpoint
CREATE INDEX "parcelle_cultures_cpf_idx" ON "cartobio"."parcelle_cultures" ("cpf");--> statement-breakpoint
CREATE INDEX "parcelles_commune_idx" ON "cartobio"."parcelles" ("commune");--> statement-breakpoint
CREATE INDEX "parcelles_geometry_gix" ON "cartobio"."parcelles" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "parcelles_annotations_parcelle_id_idx" ON "cartobio"."parcelles_annotations" ("parcelle_id");--> statement-breakpoint
CREATE INDEX "attestations_production_record_id_idx" ON "cartobio"."attestations_production" ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attestations_production_record_id_type_idx" ON "cartobio"."attestations_production" ("record_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "import_pac_numero_bio_pacage_siret_idx" ON "cartobio"."import_pac" ("numero_bio","pacage","siret");--> statement-breakpoint
CREATE INDEX "parcellaire_import_organisme_created_at_idx" ON "cartobio"."parcellaire_import" ("organisme_certificateur","created_at");--> statement-breakpoint
CREATE INDEX "parcellaire_import_logs_import_id_idx" ON "cartobio"."parcellaire_import_logs" ("import_id");--> statement-breakpoint
CREATE INDEX "parcellaire_import_payload_import_id_idx" ON "cartobio"."parcellaire_import_payload" ("import_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "cartobio"."sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "cartobio"."sessions" ("expires_at");--> statement-breakpoint
ALTER TABLE "cartobio"."departements" ADD CONSTRAINT "departements_code_region_regions_code_fkey" FOREIGN KEY ("code_region") REFERENCES "cartobio"."regions"("code");--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires" ADD CONSTRAINT "parcellaires_oc_id_organisme_certificateur_id_fkey" FOREIGN KEY ("oc_id") REFERENCES "cartobio"."organisme_certificateur"("id");--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires_evenements" ADD CONSTRAINT "parcellaires_evenements_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "cartobio"."parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires_metadata" ADD CONSTRAINT "parcellaires_metadata_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "cartobio"."parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelle_cultures" ADD CONSTRAINT "parcelle_cultures_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "cartobio"."parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelle_cultures" ADD CONSTRAINT "parcelle_cultures_parcelle_fkey" FOREIGN KEY ("record_id","parcelle_id") REFERENCES "cartobio"."parcelles"("record_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles" ADD CONSTRAINT "parcelles_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "cartobio"."parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles" ADD CONSTRAINT "parcelles_commune_communes_fid_fkey" FOREIGN KEY ("commune") REFERENCES "cartobio"."communes"("fid");--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_annotations" ADD CONSTRAINT "parcelles_annotations_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "cartobio"."parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_annotations" ADD CONSTRAINT "parcelles_annotations_parcelle_fkey" FOREIGN KEY ("record_id","parcelle_id") REFERENCES "cartobio"."parcelles"("record_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."attestations_production" ADD CONSTRAINT "attestations_production_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "cartobio"."parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_controles" ADD CONSTRAINT "parcelles_controles_record_id_parcellaires_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "cartobio"."parcellaires"("record_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_controles" ADD CONSTRAINT "parcelles_controles_parcelle_fkey" FOREIGN KEY ("record_id","parcelle_id") REFERENCES "cartobio"."parcelles"("record_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaire_import_logs" ADD CONSTRAINT "parcellaire_import_logs_import_id_parcellaire_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "cartobio"."parcellaire_import"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaire_import_payload" ADD CONSTRAINT "parcellaire_import_payload_import_id_parcellaire_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "cartobio"."parcellaire_import"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cartobio"."to_legal_projection"(geom geometry)
RETURNS geometry AS $$
BEGIN
  RETURN ST_Transform(geom, COALESCE((
    SELECT legal_projection
    FROM (
      VALUES
        (2154, ST_MakeEnvelope(-5.1412, 41.334, 9.5597, 51.0888, 4326)),
        (5490, ST_MakeEnvelope(-61.8098, 14.3947, -60.8106, 16.511, 4326)),
        (2975, ST_MakeEnvelope(55.2166, -21.3891, 55.8366, -20.8721, 4326)),
        (2972, ST_MakeEnvelope(-54.6023, 2.1111, -51.619, 5.7487, 4326)),
        (4471, ST_MakeEnvelope(45.0185, -13.0001, 45.298, -12.6366, 4326))
      ) AS t(legal_projection, region_bounds)
    WHERE ST_Intersects(ST_Transform(geom, 4326), region_bounds)
    LIMIT 1
  ), 2154));
END;
$$ LANGUAGE plpgsql;
