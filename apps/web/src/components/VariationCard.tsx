"use client";

import { DIMENSION_LABELS, type ChangeDimension } from "@adengine/core/variations";
import { applyOverrides } from "@adengine/design";
import { useCallback, useMemo, useState } from "react";
import { type Variation, type Workspace, api } from "../lib/api";
import { DesignPreview } from "./DesignPreview";
import { Button, StatusBadge } from "./ui";

export const dimensionLabel = (d: string) => DIMENSION_LABELS[d as ChangeDimension] ?? d;

export function VariationCard({
  variation,
  design,
  parentName,
  compact,
  selected,
  onSelect,
  act,
}: {
  variation: Variation;
  design?: Workspace["designs"][string];
  parentName?: string;
  compact: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const setStatus = (status: Variation["status"]) => act(() => api(`/variations/${variation.id}`, { method: "PATCH", body: { status } }));
  const [overflow, setOverflow] = useState<string[]>([]);
  const outline = selected
    ? "border-accent ring-2 ring-accent/30"
    : variation.status === "approved"
      ? "border-emerald-300"
      : variation.status === "rejected"
        ? "border-rose-200 opacity-70"
        : "border-zinc-200";
  const dims = variation.dimensions ?? [];
  const warnings = (variation.warnings ?? []).filter((w) => !/may overflow/.test(w)); // overflow is measured live instead
  const rationale = variation.rationale;

  return (
    <article aria-label={variation.name} className={`relative flex h-full flex-col overflow-hidden rounded-lg border bg-white ${outline}`}>
      <label className="absolute left-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded bg-white/90 shadow-sm ring-1 ring-zinc-300">
        <input type="checkbox" className="size-3.5 accent-[var(--color-accent)]" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${variation.name} to compare`} />
      </label>
      <PreviewSurface variation={variation} design={design} onOverflow={setOverflow} />
      <div className={`flex flex-1 flex-col gap-2 ${compact ? "p-2" : "p-3"}`}>
        <div className="flex items-start justify-between gap-2">
          <h3 className={`min-w-0 font-medium ${compact ? "truncate text-xs" : "line-clamp-2 text-sm"}`} title={variation.name}>
            {variation.name}
          </h3>
          {!compact && <StatusBadge status={variation.status} />}
        </div>
        {compact && <StatusBadge status={variation.status} />}
        {dims.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="What this variation changes">
            {dims.map((d) => (
              <span key={d} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${rationale?.outOfPlan?.includes(d) ? "bg-amber-50 text-amber-800" : "bg-indigo-50 text-indigo-700"}`}>
                {dimensionLabel(d)}
              </span>
            ))}
          </div>
        )}
        {(overflow.length > 0 || warnings.length > 0) && (
          <ul className="space-y-0.5 text-[11px] text-amber-800">
            {overflow.length > 0 && <li>Text doesn't fit: {overflow.join(", ")}</li>}
            {!compact && warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        {!compact && rationale?.summary && <p className="line-clamp-3 text-xs text-zinc-600" title={rationale.summary}>{rationale.summary}</p>}
        {!compact && rationale?.outOfPlanReason && (
          <p className="text-[11px] text-amber-800">Outside the plan: {rationale.outOfPlanReason}</p>
        )}
        {!compact && parentName && <p className="text-[11px] text-zinc-500">Built on “{parentName}”</p>}
        {!compact && (
          <p className="text-xs text-zinc-500">
            {variation.formats.length === 0 ? "No sizes yet" : variation.formats.map((f) => `${f.width}×${f.height}`).join("  ")}
          </p>
        )}
        <div className="mt-auto flex gap-1 pt-1">
          {variation.status === "approved" || variation.status === "rejected" ? (
            <Button size="sm" variant="ghost" onClick={() => setStatus("ready")}>
              Undo
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => setStatus("approved")} disabled={variation.status === "generating"}>
                Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => setStatus("rejected")} disabled={variation.status === "generating"}>
                Reject
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The preview area of a card: the variation's source design with its
 * overrides applied, drawn by the engine's renderer at the design's own size.
 * Other sizes are produced by resizing (a later step).
 */
function PreviewSurface({ variation, design, onOverflow }: { variation: Variation; design?: Workspace["designs"][string]; onOverflow: (names: string[]) => void }) {
  const base = "flex aspect-[6/5] items-center justify-center border-b border-zinc-100 px-3 text-center text-xs";
  const doc = useMemo(() => (design ? applyOverrides(design.document, variation.overrides) : undefined), [design, variation.overrides]);
  const report = useCallback((names: string[]) => onOverflow(names), [onOverflow]);
  if (variation.status === "generating") {
    return (
      <div role="status" className={`${base} preview-generating font-medium text-indigo-700`}>
        Generating…
      </div>
    );
  }
  if (variation.status === "failed") return <div className={`${base} bg-rose-50 font-medium text-rose-700`}>Generation failed</div>;
  if (doc) {
    return (
      <div className="preview-empty aspect-[6/5] border-b border-zinc-100 p-2">
        <DesignPreview document={doc} onOverflow={report} />
      </div>
    );
  }
  return <div className={`${base} preview-empty text-zinc-500`}>{variation.sourceDesignId ? "Design unavailable" : "No design attached"}</div>;
}
