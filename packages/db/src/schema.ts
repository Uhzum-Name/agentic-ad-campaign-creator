import {
  type AssetKind,
  type CampaignStatus,
  type DesignDocument,
  type DesignSource,
  type DirectionStatus,
  type ErrorBody,
  type FormatStatus,
  type JobStatus,
  type MessageKind,
  type MessageRole,
  type VariationStatus,
  newId,
} from "@adengine/core";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/*
 * Hierarchy: Project → Campaign → Creative Direction → Variation → Format → Rendered Asset.
 * Design documents, animation specs and recipes belong to a project and are
 * referenced by the production hierarchy. Jobs are the async execution record.
 *
 * Layers are not a table: they live inside `design_documents.document` (one
 * atomic JSON tree) and are addressed by their stable layer id.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date());

export const projects = pgTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => newId("project")),
  name: text("name").notNull(),
  description: text("description"),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("campaign")),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    objective: text("objective"),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_project_idx").on(t.projectId)],
);

/** Append-only: the highest `version` per campaign is the current brief. */
export const briefs = pgTable(
  "briefs",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("brief")),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    /** Structured interpretation produced by the agent (milestone 4). */
    analysis: jsonb("analysis").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("briefs_campaign_version_idx").on(t.campaignId, t.version)],
);

export const designDocuments = pgTable(
  "design_documents",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("designDocument")),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: jsonb("source").$type<DesignSource>().notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    document: jsonb("document").$type<DesignDocument>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("design_documents_project_idx").on(t.projectId)],
);

export const creativeDirections = pgTable(
  "creative_directions",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("creativeDirection")),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    concept: text("concept"),
    messagingAngle: text("messaging_angle"),
    visualTreatment: text("visual_treatment"),
    status: text("status").$type<DirectionStatus>().notNull().default("proposed"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("creative_directions_campaign_idx").on(t.campaignId)],
);

/**
 * A variation never copies its source design. It stores `overrides`: patches
 * keyed by layer id that are applied on top of the source document at render
 * time. That keeps the original intact, makes "what changed" a direct read,
 * and lets one element be edited without regenerating the ad.
 */
export const variations = pgTable(
  "variations",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("variation")),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    directionId: text("direction_id").notNull().references(() => creativeDirections.id, { onDelete: "cascade" }),
    sourceDesignId: text("source_design_id").references(() => designDocuments.id, { onDelete: "restrict" }),
    animationSpecId: text("animation_spec_id"),
    name: text("name").notNull(),
    overrides: jsonb("overrides").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
    /** Which controlled dimensions were varied (headline, cta, image, ...) and why. */
    rationale: jsonb("rationale").$type<Record<string, unknown>>(),
    status: text("status").$type<VariationStatus>().notNull().default("draft"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("variations_direction_idx").on(t.directionId), index("variations_campaign_idx").on(t.campaignId)],
);

/** One size/format of a variation. Layout differences are overrides, like variations. */
export const variationFormats = pgTable(
  "variation_formats",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("variationFormat")),
    variationId: text("variation_id").notNull().references(() => variations.id, { onDelete: "cascade" }),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    label: text("label"),
    layoutOverrides: jsonb("layout_overrides").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
    status: text("status").$type<FormatStatus>().notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("variation_formats_size_idx").on(t.variationId, t.width, t.height)],
);

/** A reusable, structured animation. The spec shape is defined in milestone 7. */
export const animationSpecs = pgTable("animation_specs", {
  id: text("id").primaryKey().$defaultFn(() => newId("animationSpec")),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const renderedAssets = pgTable(
  "rendered_assets",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("renderedAsset")),
    variationFormatId: text("variation_format_id").notNull().references(() => variationFormats.id, { onDelete: "cascade" }),
    jobId: text("job_id"),
    kind: text("kind").$type<AssetKind>().notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    validation: jsonb("validation").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("rendered_assets_format_idx").on(t.variationFormatId)],
);

/**
 * Source of truth for asynchronous work. The queue (pg-boss) only dispatches;
 * status, progress, outputs and errors are read from here.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("job")),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    parentJobId: text("parent_job_id"),
    type: text("type").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    error: jsonb("error").$type<ErrorBody>(),
    progress: real("progress").notNull().default(0),
    progressMessage: text("progress_message"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(1),
    queueJobId: text("queue_job_id"),
    cancelRequestedAt: ts("cancel_requested_at"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_project_idx").on(t.projectId), index("jobs_status_idx").on(t.status)],
);

/** A saved production workflow. `(name, version)` rows form its version history. */
export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("recipe")),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").notNull().default(1),
    steps: jsonb("steps").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("recipes_project_idx").on(t.projectId)],
);

/**
 * The per-campaign thread between people and the connected agent. A user
 * message is "pending" until an agent acknowledges it; agent and system
 * entries have no delivery status.
 */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("agentMessage")),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    kind: text("kind").$type<MessageKind>().notNull().default("message"),
    text: text("text").notNull(),
    acknowledgedAt: ts("acknowledged_at"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_messages_campaign_idx").on(t.campaignId, t.createdAt)],
);
