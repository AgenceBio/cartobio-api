CREATE TYPE "import_job_etat" AS ENUM('UNKNOWN', 'UPDATED', 'CREATED');--> statement-breakpoint
CREATE TYPE "import_job_result" AS ENUM('REJECTED', 'VALID', 'ERROR');--> statement-breakpoint
ALTER TYPE "import_status" ADD VALUE 'PENDING';--> statement-breakpoint
ALTER TABLE "parcellaire_import_logs" ADD COLUMN "parcelle_id" varchar;--> statement-breakpoint
ALTER TABLE "parcellaire_import_logs" ADD COLUMN "parcelle_name" varchar;--> statement-breakpoint
ALTER TABLE "parcellaires_import" ADD COLUMN "statut_job" "import_job_result";--> statement-breakpoint
ALTER TABLE "parcellaires_import" ADD COLUMN "etat" "import_job_etat" DEFAULT 'UNKNOWN'::"import_job_etat" NOT NULL;