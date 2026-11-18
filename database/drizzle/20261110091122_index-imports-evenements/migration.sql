DROP INDEX "cartobio"."parcellaires_evenements_record_id_idx";--> statement-breakpoint
DROP INDEX "cartobio"."parcelle_cultures_record_id_idx";--> statement-breakpoint
DROP INDEX "cartobio"."parcelles_record_id_idx";--> statement-breakpoint
DROP INDEX "cartobio"."parcelles_annotations_record_id_idx";--> statement-breakpoint
CREATE INDEX "parcellaires_evenements_record_id_date_idx" ON "cartobio"."parcellaires_evenements" ("record_id","date");--> statement-breakpoint
CREATE INDEX "parcellaire_import_organisme_created_at_idx" ON "cartobio"."parcellaire_import" ("organisme_certificateur","created_at");--> statement-breakpoint
CREATE INDEX "parcellaire_import_payload_import_id_idx" ON "cartobio"."parcellaire_import_payload" ("import_id");