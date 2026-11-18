CREATE TABLE "project_fonts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"family" text NOT NULL,
	"weight" integer NOT NULL,
	"style" text NOT NULL,
	"format" text NOT NULL,
	"asset_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"file_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_fonts" ADD CONSTRAINT "project_fonts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_fonts_face_idx" ON "project_fonts" USING btree ("project_id",lower("family"),"weight","style");