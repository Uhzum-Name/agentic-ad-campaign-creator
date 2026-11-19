"use client";

import type { CampaignStatus, DirectionStatus, FormatStatus, MessageKind, MessageRole, VariationStatus } from "@adengine/core/entities";
import type { DesignDocument } from "@adengine/core/design";
import type { BriefAnalysis, ClarifyingQuestion, CreativePlan, PlanEstimate, PlanStatus } from "@adengine/core/planning";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  campaignCount?: number;
}
export interface Campaign {
  id: string;
  projectId: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}
export interface Brief {
  id: string;
  version: number;
  text: string;
  analysis: BriefAnalysis | null;
  analyzedAt: string | null;
  createdAt: string;
}
export interface Plan {
  id: string;
  campaignId: string;
  version: number;
  status: PlanStatus;
  plan: CreativePlan;
  estimate: PlanEstimate;
  briefVersion: number | null;
  feedback: string | null;
  decidedBy: "user" | "agent" | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}
export interface Format {
  id: string;
  width: number;
  height: number;
  label: string | null;
  status: FormatStatus;
}
export interface Variation {
  id: string;
  directionId: string;
  name: string;
  status: VariationStatus;
  sourceDesignId: string | null;
  overrides: Record<string, Record<string, unknown>>;
  parentVariationId: string | null;
  dimensions: string[] | null;
  warnings: string[] | null;
  rationale: { summary?: string; outOfPlanReason?: string; outOfPlan?: string[] } | null;
  formats: Format[];
}
export interface Direction {
  id: string;
  name: string;
  concept: string | null;
  messagingAngle: string | null;
  visualTreatment: string | null;
  status: DirectionStatus;
  plannedVariations: number | null;
  varyElements: string[] | null;
  variations: Variation[];
}
export interface Design {
  id: string;
  projectId: string;
  name: string;
  width: number;
  height: number;
  source: { kind: "fixture"; name: string } | { kind: "figma"; fileKey: string; nodeId: string } | { kind: "manual" };
  document: DesignDocument;
  referenceAssetKey: string | null;
  importReport: {
    webFontsUnavailable?: string[];
    rasterized?: { nodeId: string; name: string; reason: string }[];
    skipped?: { nodeId: string; name: string; reason: string }[];
    warnings?: string[];
  } | null;
  createdAt: string;
  /** Present in project design lists. */
  usageCount?: number;
}
export interface DesignUsage {
  variationId: string;
  variationName: string;
  status: Variation["status"];
  directionId: string;
  directionName: string;
  campaignId: string;
  campaignName: string;
}
export interface ProjectFont {
  id: string;
  projectId: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
  format: "truetype" | "opentype" | "woff" | "woff2";
  assetKey: string;
  bytes: number;
  fileName: string | null;
  createdAt: string;
}

/** Uploads one font file as the raw request body; the server reads its family, weight and style. */
export async function uploadFontFile(projectId: string, file: File): Promise<ProjectFont & { replaced: boolean }> {
  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/fonts?fileName=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ApiError("Could not reach the server. Check that the API is running.", 0);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = res.status === 413 ? "The file is too large (4 MB limit)." : (payload?.error?.message ?? `The upload failed (${res.status}).`);
    throw new ApiError(message, res.status, payload?.error?.code);
  }
  return payload.data;
}

export interface ProjectImage {
  id: string;
  name: string;
  assetKey: string;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/** Uploads an image file as the raw request body. */
export async function uploadImageFile(projectId: string, file: File): Promise<ProjectImage> {
  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/images?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ApiError("Could not reach the server.", 0);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status === 413 ? "The image is too large (4 MB limit)." : (payload?.error?.message ?? `The upload failed (${res.status}).`), res.status);
  return payload.data;
}

export interface Job {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  progressMessage: string | null;
  output: unknown;
  error: { code: string; message: string } | null;
}
export interface Workspace {
  campaign: Campaign;
  designs: Record<string, Pick<Design, "id" | "name" | "width" | "height" | "document">>;
  brief: Brief | null;
  latestPlan: Plan | null;
  directions: Direction[];
}
export interface Message {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  acknowledgedAt: string | null;
  question: ClarifyingQuestion | null;
  answer: string | null;
  answeredAt: string | null;
  planId: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Calls the engine API through the same-origin /api proxy. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Could not reach the server. Check that the API is running.", 0);
  }
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(payload?.error?.message ?? `The request failed (${res.status}).`, res.status, payload?.error?.code);
  }
  return payload.data as T;
}

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads a resource and, when `pollMs` is set, keeps it fresh so work produced
 * by an agent or a background job appears without a manual reload. Polling
 * pauses while the tab is hidden.
 */
export function useResource<T>(path: string | null, pollMs?: number): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(path !== null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    if (path === null) return;
    const ticket = ++latest.current;
    try {
      const result = await api<T>(path);
      if (ticket !== latest.current) return;
      setData(result);
      setError(undefined);
    } catch (err) {
      if (ticket !== latest.current) return;
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    setLoading(path !== null);
    void refresh();
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    return () => clearInterval(timer);
  }, [path, pollMs, refresh]);

  return { data, error, loading, refresh };
}

export const assetUrl = (key: string) => `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Polls a job until it finishes; resolves with the finished job. */
export async function waitForJob(job: Job, onUpdate?: (job: Job) => void): Promise<Job> {
  let current = job;
  while (current.status === "queued" || current.status === "running") {
    await new Promise((r) => setTimeout(r, 1000));
    current = await api<Job>(`/jobs/${current.id}`);
    onUpdate?.(current);
  }
  return current;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
