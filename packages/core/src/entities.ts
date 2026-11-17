// Browser-safe: imported by the web app via "@adengine/core/entities". Keep free of Node-only imports.
import { z } from "zod";

/** Status vocabularies. Kept here so API, DB, UI and agent tools agree. */
export const CAMPAIGN_STATUSES = ["draft", "planning", "in_production", "in_review", "complete"] as const;
export const DIRECTION_STATUSES = ["proposed", "approved", "rejected"] as const;
export const VARIATION_STATUSES = ["draft", "generating", "ready", "approved", "rejected", "failed"] as const;
export const FORMAT_STATUSES = ["pending", "ready", "failed"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const MESSAGE_ROLES = ["user", "agent", "system"] as const;
export const MESSAGE_KINDS = ["message", "activity"] as const;
export const ASSET_KINDS = ["preview", "html5", "mp4", "gif", "png", "jpeg"] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type DirectionStatus = (typeof DIRECTION_STATUSES)[number];
export type VariationStatus = (typeof VARIATION_STATUSES)[number];
export type FormatStatus = (typeof FORMAT_STATUSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type AssetKind = (typeof ASSET_KINDS)[number];
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

const name = z.string().trim().min(1).max(200);

export const CreateProjectInput = z.object({
  name,
  description: z.string().max(5000).optional(),
});
export const UpdateProjectInput = CreateProjectInput.partial().extend({
  archived: z.boolean().optional(),
});

export const CreateCampaignInput = z.object({
  name,
  objective: z.string().max(5000).optional(),
});
export const UpdateCampaignInput = CreateCampaignInput.partial().extend({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
});

/** A brief is versioned: each save appends a new version; history is kept. */
export const SaveBriefInput = z.object({
  text: z.string().trim().min(1).max(50_000),
});

export const CreateDirectionInput = z.object({
  name,
  concept: z.string().max(5000).optional(),
  messagingAngle: z.string().max(5000).optional(),
  visualTreatment: z.string().max(5000).optional(),
});
export const UpdateDirectionInput = CreateDirectionInput.partial().extend({
  status: z.enum(DIRECTION_STATUSES).optional(),
});

const Size = z.object({
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
  label: z.string().max(100).optional(),
});
export const CreateVariationInput = z.object({
  name,
  sourceDesignId: z.string().optional(),
  sizes: z.array(Size).max(50).optional(),
});
export const UpdateVariationInput = z.object({
  name: name.optional(),
  status: z.enum(VARIATION_STATUSES).optional(),
});

/**
 * The campaign thread shown in the agent panel. People leave direction
 * (role "user"); a connected agent posts replies and activity (role "agent").
 * User messages start "pending" until an agent acknowledges them.
 */
export const PostMessageInput = z.object({
  text: z.string().trim().min(1).max(20_000),
  role: z.enum(["user", "agent"]).default("user"),
  kind: z.enum(MESSAGE_KINDS).default("message"),
});

export const CreateJobInput = z.object({
  type: z.string().min(1),
  input: z.unknown().optional(),
  projectId: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInput>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;
export type CreateCampaignInput = z.infer<typeof CreateCampaignInput>;
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignInput>;
export type SaveBriefInput = z.infer<typeof SaveBriefInput>;
export type CreateJobInput = z.infer<typeof CreateJobInput>;
export type CreateDirectionInput = z.infer<typeof CreateDirectionInput>;
export type UpdateDirectionInput = z.infer<typeof UpdateDirectionInput>;
export type CreateVariationInput = z.infer<typeof CreateVariationInput>;
export type UpdateVariationInput = z.infer<typeof UpdateVariationInput>;
export type PostMessageInput = z.infer<typeof PostMessageInput>;
