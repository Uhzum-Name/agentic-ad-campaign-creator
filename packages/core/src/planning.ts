// Browser-safe: imported by the web app via "@adengine/core/planning".
import { z } from "zod";

/*
 * Structured outputs of the agent's planning work. The connected agent (an
 * MCP client) does the thinking; the engine validates what it submits against
 * these schemas, stores it, and turns an approved plan into directions.
 */

const text = (max = 2000) => z.string().trim().min(1).max(max);

/** The agent's reading of a brief. Stored with the brief version it describes. */
export const BriefAnalysis = z.object({
  summary: text(3000).describe("Two or three sentences restating what the campaign must achieve"),
  objective: text().optional().describe("The single business or communication goal"),
  audience: text().optional(),
  product: text().optional().describe("What is being advertised"),
  keyMessages: z.array(text(500)).max(12).default([]),
  callToAction: text(300).optional(),
  offer: text(500).optional(),
  tone: text(500).optional(),
  mandatories: z.array(text(500)).max(20).default([]).describe("Things every ad must include: legal lines, logos, claims"),
  constraints: z.array(text(500)).max(20).default([]).describe("Things to avoid, brand rules, technical limits"),
  requestedFormats: z.array(text(100)).max(30).default([]).describe("Sizes or formats the brief asks for, as written"),
  missingInformation: z
    .array(z.object({ topic: text(200), why: text(500) }))
    .max(12)
    .default([])
    .describe("What the brief does not say that the plan depends on"),
});
export type BriefAnalysis = z.infer<typeof BriefAnalysis>;

/** One-click questions for the person running the campaign. */
export const ClarifyingQuestion = z.object({
  question: text(500),
  /** Suggested answers shown as buttons. Empty means free text only. */
  options: z.array(text(200)).max(6).default([]),
  /** Whether the person may type their own answer as well. */
  allowOther: z.boolean().default(true),
  why: text(500).optional().describe("Why the answer matters, shown under the question"),
});
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestion>;
export const AskQuestionsInput = z.object({ questions: z.array(ClarifyingQuestion).min(1).max(8) });

export const VARY_ELEMENTS = ["headline", "subheadline", "body", "image", "offer", "cta", "layout", "messaging", "visual_treatment", "animation"] as const;
export const OUTPUT_FORMATS = ["html5", "mp4", "gif", "png", "jpeg"] as const;

export const PlanDirection = z.object({
  name: text(200),
  concept: text(2000).describe("The creative idea in a sentence or two"),
  messagingAngle: text(1000).describe("What the copy leads with"),
  visualTreatment: text(1000).optional(),
  sourceDesignId: z.string().optional().describe("Design (dsn_...) the variations start from"),
  variationCount: z.number().int().min(1).max(50),
  varyElements: z.array(z.enum(VARY_ELEMENTS)).min(1).describe("Which parts change between this direction's variations"),
  sampleHeadlines: z.array(text(300)).max(10).default([]),
});
export type PlanDirection = z.infer<typeof PlanDirection>;

export const CreativePlan = z.object({
  objective: text(),
  audience: text(),
  messaging: z.array(text(500)).min(1).max(12).describe("Key messages across the campaign"),
  tone: text(500).optional(),
  directions: z.array(PlanDirection).min(1).max(20),
  formats: z
    .array(z.object({ width: z.number().int().min(1).max(10_000), height: z.number().int().min(1).max(10_000), label: z.string().max(100).optional() }))
    .min(1)
    .max(30),
  outputs: z.array(z.enum(OUTPUT_FORMATS)).min(1),
  animation: text(1000).optional().describe("Intended motion, if any"),
  workflow: z.array(text(500)).min(1).max(20).describe("Ordered production steps"),
  assumptions: z.array(text(500)).max(20).default([]),
  rationale: text(3000).optional().describe("Why these directions for this brief"),
});
export type CreativePlan = z.infer<typeof CreativePlan>;

export const PLAN_STATUSES = ["proposed", "changes_requested", "approved", "superseded"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Rough per-file production time, used only for the estimate shown with a plan. */
const SECONDS_PER_OUTPUT: Record<(typeof OUTPUT_FORMATS)[number], number> = { png: 2, jpeg: 2, html5: 3, gif: 15, mp4: 20 };

export interface PlanEstimate {
  directions: number;
  variations: number;
  sizes: number;
  /** variations × sizes */
  creatives: number;
  /** creatives × outputs */
  files: number;
  /** Order-of-magnitude rendering time on one worker, in minutes. */
  renderMinutes: number;
  notes: string[];
}

/**
 * What a plan would produce. Engine compute is the only cost the platform
 * itself incurs; the agent's model usage is billed to whoever runs the agent
 * and is not measured here.
 */
export function estimatePlan(plan: CreativePlan): PlanEstimate {
  const variations = plan.directions.reduce((n, d) => n + d.variationCount, 0);
  const sizes = plan.formats.length;
  const creatives = variations * sizes;
  const files = creatives * plan.outputs.length;
  const seconds = creatives * plan.outputs.reduce((s, o) => s + SECONDS_PER_OUTPUT[o], 0);
  return {
    directions: plan.directions.length,
    variations,
    sizes,
    creatives,
    files,
    renderMinutes: Math.max(1, Math.round(seconds / 60)),
    notes: [
      "Render time is a rough figure for one worker and will be measured once exports exist.",
      "The agent's own model usage is billed to the account running the agent and is not included.",
    ],
  };
}
