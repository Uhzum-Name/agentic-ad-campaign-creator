CREATE TABLE "stored_objects" (
	"key" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_documents" ADD COLUMN "reference_asset_key" text;--> statement-breakpoint
ALTER TABLE "design_documents" ADD COLUMN "import_report" jsonb;