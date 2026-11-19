"use client";

import { applyOverrides, diffDocuments } from "@adengine/design";
import { useEffect, useMemo } from "react";
import { type ProjectImage, type Variation, type Workspace, useResource } from "../lib/api";
import { DesignPreview } from "./DesignPreview";
import { dimensionLabel } from "./VariationCard";
import { Button, StatusBadge } from "./ui";

/** Side-by-side comparison of 2–4 variations: previews, and what differs. */
export function CompareView({ items, workspace, onClose }: { items: Variation[]; workspace: Workspace; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const library = useResource<ProjectImage[]>(`/projects/${workspace.campaign.projectId}/images`);
  const assetName = useMemo(() => {
    const names = new Map((library.data ?? []).map((i) => [i.assetKey, i.name]));
    return (key: string) => names.get(key);
  }, [library.data]);
  const entries = useMemo(
    () =>
      items.map((v) => {
        const design = v.sourceDesignId ? workspace.designs[v.sourceDesignId] : undefined;
        const doc = design ? applyOverrides(design.document, v.overrides) : undefined;
        return { v, design, doc, fromSource: design && doc ? diffDocuments(design.document, doc, { assetName }) : [] };
      }),
    [items, workspace.designs, assetName],
  );
  const first = entries[0];
  const directionName = (id: string) => workspace.directions.find((d) => d.id === id)?.name ?? "";

  return (
    <div role="dialog" aria-modal="true" aria-label="Compare variations" className="fixed inset-0 z-40 flex flex-col bg-zinc-900/40 p-4 backdrop-blur-[2px]">
      <div className="mx-auto flex max-h-full w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold">Comparing {items.length} variations</h2>
          <span className="text-xs text-zinc-500">Differences are shown against the first one and against each source design.</span>
          <Button className="ml-auto" onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="grid min-h-0 flex-1 auto-cols-fr grid-flow-col gap-4 overflow-auto p-4">
          {entries.map(({ v, doc, fromSource }, i) => {
            const vsFirst = i > 0 && first?.doc && doc && v.sourceDesignId === first.v.sourceDesignId ? diffDocuments(first.doc, doc, { assetName }) : null;
            return (
              <section key={v.id} className="flex min-w-[240px] flex-col gap-3">
                <div className="preview-empty aspect-[6/5] rounded-lg border border-zinc-200 p-3">{doc ? <DesignPreview document={doc} maxScale={2} /> : <p className="text-xs text-zinc-500">No design attached</p>}</div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-medium">{v.name}</h3>
                    <StatusBadge status={v.status} />
                  </div>
                  <p className="text-xs text-zinc-500">{directionName(v.directionId)}</p>
                  {v.rationale?.summary && <p className="mt-1 text-xs text-zinc-700">{v.rationale.summary}</p>}
                </div>
                {i > 0 && (
                  <DiffList
                    title={`Differs from “${first!.v.name}”`}
                    diffs={vsFirst}
                    empty={vsFirst === null ? "Built on a different design, so not compared element by element." : "Identical to the first."}
                  />
                )}
                <DiffList title="Changed from the source design" diffs={fromSource} empty="No changes: this is the original design." />
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DiffList({ title, diffs, empty }: { title: string; diffs: ReturnType<typeof diffDocuments> | null; empty: string }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
      {!diffs || diffs.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {diffs.map((d, i) => (
            <li key={`${d.layerId}-${d.field}-${i}`} className="text-xs">
              <span className="font-medium text-zinc-900">
                {dimensionLabel(d.dimension) === d.field ? d.field : `${dimensionLabel(d.dimension)} · ${d.field}`}
              </span>
              <span className="block whitespace-pre-wrap break-words text-zinc-500 line-through decoration-zinc-300">{d.before}</span>
              <span className="block whitespace-pre-wrap break-words text-zinc-900">{d.after}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
