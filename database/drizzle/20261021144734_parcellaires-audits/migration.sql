ALTER TABLE "cartobio"."parcellaires_evenements" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires_evenements" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires_metadata" ADD COLUMN "copy_of" text;--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires_metadata" ADD COLUMN "warnings" jsonb;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelle_cultures" ADD COLUMN "commentaire" text;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelle_cultures" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_annotations" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelle_cultures" DROP CONSTRAINT "parcelle_cultures_pkey";--> statement-breakpoint
ALTER TABLE "cartobio"."parcelle_cultures" ADD PRIMARY KEY ("record_id","parcelle_id","id");--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_annotations" DROP CONSTRAINT "parcelles_annotations_pkey";--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_annotations" ADD PRIMARY KEY ("record_id","parcelle_id","id");--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires_evenements" ALTER COLUMN "certification_etat" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cartobio"."parcellaires_metadata" ALTER COLUMN "source_updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cartobio"."parcelles_annotations" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "parcellaires_numerobio_audit_date_idx" ON "cartobio"."parcellaires" ("numerobio","audit_date") WHERE "deleted_at" IS NULL;--> statement-breakpoint
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
