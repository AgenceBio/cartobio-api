ALTER TABLE "cartobio"."parcelle_cultures" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelle_cultures" ALTER COLUMN "id" DROP DEFAULT;