CREATE TABLE "project_images" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"asset_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "variations" ADD COLUMN "parent_variation_id" text;--> statement-breakpoint
ALTER TABLE "variations" ADD COLUMN "changes" jsonb;--> statement-breakpoint
ALTER TABLE "variations" ADD COLUMN "dimensions" jsonb;--> statement-breakpoint
ALTER TABLE "variations" ADD COLUMN "warnings" jsonb;--> statement-breakpoint
ALTER TABLE "project_images" ADD CONSTRAINT "project_images_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_images_project_idx" ON "project_images" USING btree ("project_id");