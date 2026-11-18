CREATE TABLE "creative_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"plan" jsonb NOT NULL,
	"estimate" jsonb NOT NULL,
	"brief_version" integer,
	"feedback" text,
	"decided_by" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "question" jsonb;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN "analyzed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creative_directions" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "creative_directions" ADD COLUMN "planned_variations" integer;--> statement-breakpoint
ALTER TABLE "creative_directions" ADD COLUMN "vary_elements" jsonb;--> statement-breakpoint
ALTER TABLE "creative_directions" ADD COLUMN "source_design_id" text;--> statement-breakpoint
ALTER TABLE "creative_directions" ADD COLUMN "sample_headlines" jsonb;--> statement-breakpoint
ALTER TABLE "creative_plans" ADD CONSTRAINT "creative_plans_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_plans_campaign_version_idx" ON "creative_plans" USING btree ("campaign_id","version");