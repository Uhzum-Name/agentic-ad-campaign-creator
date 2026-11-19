"use client";

import { useMemo, useState } from "react";
import { type Design, type Direction, type Variation, type Workspace, api, useResource } from "../lib/api";
import { PRESET_SIZES } from "../lib/sizes";
import { CompareView } from "./CompareView";
import { VariationCard } from "./VariationCard";
import { CreateForm } from "./CreateForm";
import { Button, EmptyState, ErrorNote, StatusBadge, inputClass } from "./ui";


const FILTERS = [
  { id: "all", label: "All", match: (_: Variation) => true },
  { id: "review", label: "Needs review", match: (v: Variation) => v.status === "ready" || v.status === "draft" },
  { id: "approved", label: "Approved", match: (v: Variation) => v.status === "approved" },
  { id: "rejected", label: "Rejected", match: (v: Variation) => v.status === "rejected" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];
type Density = "large" | "compact";

export function VariationGrid({ workspace, onChange }: { workspace: Workspace; onChange: () => Promise<void> }) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [density, setDensity] = useState<Density>("large");
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const projectDesigns = useResource<Design[]>(`/projects/${workspace.campaign.projectId}/designs`);

  const all = useMemo(() => workspace.directions.flatMap((d) => d.variations), [workspace]);
  const activeFilter = FILTERS.find((f) => f.id === filter)!;
  const nameById = useMemo(() => new Map(all.map((v) => [v.id, v.name])), [all]);
  // Forget selections of variations that no longer exist.
  const liveSelected = selected.filter((id) => nameById.has(id));
  const toggle = (id: string, on: boolean) => setSelected((cur) => (on ? [...cur.filter((x) => x !== id), id].slice(-4) : cur.filter((x) => x !== id)));

  /** Runs a mutation, then reloads the grid; failures are shown, never swallowed. */
  async function act(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const addDirection = (name: string) =>
    api(`/campaigns/${workspace.campaign.id}/directions`, { method: "POST", body: { name } }).then(onChange);

  if (workspace.directions.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4 pt-10">
        {workspace.latestPlan?.status === "proposed" ? (
          <EmptyState title="No creative directions yet">Approve the plan above to create its directions here, or request changes.</EmptyState>
        ) : (
          <EmptyState title="No creative directions yet">
            Directions and their variations appear here as the agent produces them. You can also add a direction yourself.
          </EmptyState>
        )}
        <CreateForm label="Direction name" placeholder="Name a creative direction" submitLabel="Add direction" onCreate={addDirection} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter variations" className="flex rounded-md border border-zinc-300 bg-white p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${filter === f.id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{all.filter(f.match).length}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {liveSelected.length > 0 && (
            <>
              <span className="text-xs text-zinc-600">{liveSelected.length} selected</span>
              <Button size="sm" variant="primary" disabled={liveSelected.length < 2} onClick={() => setComparing(true)} title={liveSelected.length < 2 ? "Select at least two" : undefined}>
                Compare
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </>
          )}
        </div>
        <div role="group" aria-label="Card size" className="flex rounded-md border border-zinc-300 bg-white p-0.5">
          {(["large", "compact"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={density === d}
              onClick={() => setDensity(d)}
              className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${density === d ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {comparing && liveSelected.length >= 2 && (
        <CompareView items={liveSelected.map((id) => all.find((v) => v.id === id)!)} workspace={workspace} onClose={() => setComparing(false)} />
      )}

      {workspace.directions.map((direction) => (
        <DirectionSection key={direction.id} direction={direction} designs={workspace.designs} projectDesigns={projectDesigns.data ?? []} visible={direction.variations.filter(activeFilter.match)} filtered={filter !== "all"} density={density} act={act} selected={liveSelected} onSelect={toggle} nameById={nameById} />
      ))}

      <div className="max-w-xl border-t border-zinc-200 pt-4">
        <CreateForm label="Direction name" placeholder="Name another creative direction" submitLabel="Add direction" onCreate={addDirection} />
      </div>
    </div>
  );
}

function DirectionSection({
  direction,
  designs,
  projectDesigns,
  visible,
  filtered,
  density,
  act,
  selected,
  onSelect,
  nameById,
}: {
  direction: Direction;
  designs: Workspace["designs"];
  projectDesigns: Design[];
  visible: Variation[];
  filtered: boolean;
  density: Density;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  selected: string[];
  onSelect: (id: string, on: boolean) => void;
  nameById: Map<string, string>;
}) {
  const [adding, setAdding] = useState(false);
  const [sourceDesignId, setSourceDesignId] = useState("");
  const setStatus = (status: Direction["status"]) => act(() => api(`/directions/${direction.id}`, { method: "PATCH", body: { status } }));
  const columns = density === "large" ? "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]";
  const summary = [direction.concept, direction.messagingAngle, direction.visualTreatment].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby={`${direction.id}-title`} className="rounded-xl border border-zinc-200 bg-white">
      <header className="flex flex-wrap items-start gap-3 border-b border-zinc-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 id={`${direction.id}-title`} className="truncate text-sm font-semibold">
              {direction.name}
            </h2>
            <StatusBadge status={direction.status} />
            <span className="text-xs text-zinc-500">
              {direction.plannedVariations
                ? `${direction.variations.length} of ${direction.plannedVariations} planned variations`
                : `${direction.variations.length} variation${direction.variations.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {summary && <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{summary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {direction.status !== "approved" && (
            <Button size="sm" onClick={() => setStatus("approved")}>
              Approve direction
            </Button>
          )}
          {direction.status !== "rejected" && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("rejected")}>
              Reject
            </Button>
          )}
          {direction.status !== "proposed" && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("proposed")}>
              Reset
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            Add variation
          </Button>
        </div>
      </header>

      {adding && (
        <div className="space-y-2 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-zinc-600">
            <span className="shrink-0">Source design</span>
            <select className={`${inputClass} h-9 py-0`} value={sourceDesignId} onChange={(e) => setSourceDesignId(e.target.value)}>
              <option value="">None</option>
              {projectDesigns.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.width}×{d.height})
                </option>
              ))}
            </select>
          </label>
          <CreateForm
            label="Variation name"
            placeholder="Variation name"
            submitLabel="Add variation"
            onCreate={async (name) => {
              await act(() => api(`/directions/${direction.id}/variations`, { method: "POST", body: { name, sizes: PRESET_SIZES, ...(sourceDesignId ? { sourceDesignId } : {}) } }));
              setAdding(false);
            }}
          />
          <p className="mt-2 text-xs text-zinc-500">Added with the five standard sizes: {PRESET_SIZES.map((s) => `${s.width}×${s.height}`).join(", ")}.</p>
        </div>
      )}

      <div className="p-4">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">{filtered ? "No variations match this filter." : "No variations in this direction yet."}</p>
        ) : (
          <ul className={`grid gap-3 ${columns}`}>
            {visible.map((v) => (
              <li key={v.id}>
                <VariationCard
                  variation={v}
                  design={v.sourceDesignId ? designs[v.sourceDesignId] : undefined}
                  parentName={v.parentVariationId ? nameById.get(v.parentVariationId) : undefined}
                  compact={density === "compact"}
                  selected={selected.includes(v.id)}
                  onSelect={(on) => onSelect(v.id, on)}
                  act={act}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
