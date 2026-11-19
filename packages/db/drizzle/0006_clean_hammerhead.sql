CREATE TABLE "variation_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"variation_id" text NOT NULL,
	"revision" integer NOT NULL,
	"overrides" jsonb NOT NULL,
	"edited_by" text NOT NULL,
	"note" text,
	"dimensions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "variation_id" text;--> statement-breakpoint
ALTER TABLE "variations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_revisions" ADD CONSTRAINT "variation_revisions_variation_id_variations_id_fk" FOREIGN KEY ("variation_id") REFERENCES "public"."variations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "variation_revisions_idx" ON "variation_revisions" USING btree ("variation_id","revision");