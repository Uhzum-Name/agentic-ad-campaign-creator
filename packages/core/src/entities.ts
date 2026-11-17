import { z } from "zod";

/** Status vocabularies. Kept here so API, DB, UI and agent tools agree. */
export const CAMPAIGN_STATUSES = ["draft", "planning", "in_production", "in_review", "complete"] as const;
export const DIRECTION_STATUSES = ["proposed", "approved", "rejected"] as const;
export const VARIATION_STATUSES = ["draft", "generating", "ready", "approved", "rejected", "failed"] as const;
export const FORMAT_STATUSES = ["pending", "ready", "failed"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const ASSET_KINDS = ["preview", "html5", "mp4", "gif", "png", "jpeg"] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type DirectionStatus = (typeof DIRECTION_STATUSES)[number];
export type VariationStatus = (typeof VARIATION_STATUSES)[number];
export type FormatStatus = (typeof FORMAT_STATUSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type AssetKind = (typeof ASSET_KINDS)[number];

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
