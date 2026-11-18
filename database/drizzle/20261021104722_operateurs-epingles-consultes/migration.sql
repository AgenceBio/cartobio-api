DROP TABLE "cartobio"."parcellaires_consultes";--> statement-breakpoint
DROP TABLE "cartobio"."parcellaires_epingles";--> statement-breakpoint
CREATE TABLE "cartobio"."operateurs_consultes" (
	"numerobio" integer,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operateurs_consultes_pkey" PRIMARY KEY("numerobio","user_id")
);
--> statement-breakpoint
CREATE TABLE "cartobio"."operateurs_epingles" (
	"numerobio" integer,
	"user_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operateurs_epingles_pkey" PRIMARY KEY("numerobio","user_id")
);
