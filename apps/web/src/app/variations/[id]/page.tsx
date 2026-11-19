"use client";

import type { DesignDocument } from "@adengine/core/design";
import type { VariationChange } from "@adengine/core/variations";
import { type LayerOverrides, ORDER_KEY, applyOverrides, changedDimensions, compileChanges, diffDocuments, getLayer, listLayers, summarizeDesign } from "@adengine/design";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectFontsProvider, useProjectFonts } from "../../../components/ProjectFonts";
import { dimensionLabel } from "../../../components/VariationCard";
import { EditorCanvas } from "../../../components/editor/EditorCanvas";
import { LayerPanel } from "../../../components/editor/LayerPanel";
import { type ImageChoice, PropertiesPanel } from "../../../components/editor/PropertiesPanel";
import { useEditorHistory } from "../../../components/editor/useEditorHistory";
import { Button, EmptyState, ErrorNote, Skeleton, StatusBadge, TopBar, inputClass } from "../../../components/ui";
import { ApiError, type Project, type ProjectImage, type Variation, api, timeAgo, useResource } from "../../../lib/api";

interface EditData {
  variation: Variation & { revision: number; campaignId: string };
  design: { id: string; name: string; width: number; height: number; projectId: string; document: DesignDocument } | null;
  direction: { id: string; name: string };
  campaign: { id: string; name: string; projectId: string };
  revisions: { revision: number; editedBy: "user" | "agent"; note: string | null; dimensions: string[] | null; createdAt: string }[];
}

export default function VariationEditorPage() {
  const { id } = useParams<{ id: string }>();
  const data = useResource<EditData>(`/variations/${id}/edit`);
  const project = useResource<Project>(data.data ? `/projects/${data.data.campaign.projectId}` : null);

  if (data.error?.status === 404) {
    return (
      <div className="flex min-h-full flex-col">
        <TopBar crumbs={[{ label: "Projects", href: "/" }]} />
        <main className="mx-auto w-full max-w-3xl px-4 py-8">
          <EmptyState title="Variation not found" action={<Link className="text-sm font-medium text-accent" href="/">Back to projects</Link>}>
            It may have been deleted.
          </EmptyState>
        </main>
      </div>
    );
  }
  const d = data.data;
  return (
    <ProjectFontsProvider projectId={d?.campaign.projectId}>
      <div className="flex h-full flex-col">
        {!d || !d.design ? (
          <>
            <TopBar crumbs={[{ label: "Projects", href: "/" }]} />
            <div className="p-4">
              {data.error && <ErrorNote>{data.error.message}</ErrorNote>}
              {d && !d.design && <ErrorNote>This variation has no source design, so there is nothing to edit.</ErrorNote>}
              {data.loading && <Skeleton className="h-96" />}
            </div>
          </>
        ) : (
          <Editor key={`${d.variation.id}`} data={d} projectName={project.data?.name} reload={data.refresh} />
        )}
      </div>
    </ProjectFontsProvider>
  );
}

type Panel = "element" | "history" | "ask";

function Editor({ data, projectName, reload }: { data: EditData; projectName?: string; reload: () => Promise<void> }) {
  const design = data.design!;
  const v = data.variation;
  const history = useEditorHistory(v.overrides);
  const working = history.current;
  const [savedRevision, setSavedRevision] = useState(v.revision);
  const [savedOverrides, setSavedOverrides] = useState<LayerOverrides>(v.overrides);
  const [selected, setSelected] = useState<string>();
  const [panel, setPanel] = useState<Panel>("element");
  const [error, setError] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [conflict, setConflict] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [overflow, setOverflow] = useState<string[]>([]);
  const dirty = JSON.stringify(working) !== JSON.stringify(savedOverrides);

  // A new revision from the server (after saving or restoring) becomes the clean starting point.
  useEffect(() => {
    if (v.revision !== savedRevision) {
      setSavedRevision(v.revision);
      setSavedOverrides(v.overrides);
      history.reset(v.overrides);
      setConflict(null);
    }
  }, [v.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = useMemo(() => applyOverrides(design.document, working), [design.document, working]);
  const layers = useMemo(() => listLayers(doc), [doc]);

  const changedIds = useMemo(() => new Set(Object.keys(working).filter((k) => k !== ORDER_KEY)), [working]);
  const info = layers.find((l) => l.id === selected);
  const layer = selected ? getLayer(doc, selected) : undefined;

  const library = useResource<ProjectImage[]>(`/projects/${data.campaign.projectId}/images`);
  const images: ImageChoice[] = useMemo(() => {
    const out = new Map<string, ImageChoice>();
    for (const i of library.data ?? []) out.set(i.assetKey, { assetKey: i.assetKey, name: i.name, source: "library" });
    for (const i of summarizeDesign(design.document).images) if (!out.has(i.assetKey)) out.set(i.assetKey, { assetKey: i.assetKey, name: i.name, source: "design" });
    return [...out.values()];
  }, [library.data, design.document]);
  const imageName = useMemo(() => {
    // Library images by the name they were uploaded with; design images keep their file name.
    const names = new Map(images.filter((i) => i.source === "library").map((i) => [i.assetKey, i.name]));
    return (key: string) => names.get(key);
  }, [images]);
  const diffs = useMemo(() => diffDocuments(design.document, doc, { assetName: imageName }), [design.document, doc, imageName]);
  const { fonts: uploaded } = useProjectFonts();
  const fonts = useMemo(() => [...new Set([...(uploaded ?? []).map((f) => f.family), ...summarizeDesign(design.document).fonts])].sort(), [uploaded, design.document]);

  /** Every edit goes through the same validation as the agent's changes. */
  const apply = useCallback(
    (changes: VariationChange[], coalesceKey?: string) => {
      const r = compileChanges(design.document, changes, { base: working });
      if (r.errors.length) {
        setError(r.errors.join(" "));
        return;
      }
      setError(undefined);
      setWarnings(r.warnings);
      history.push(r.overrides, coalesceKey);
    },
    [design.document, working, history],
  );

  function resetLayer(id: string) {
    const next = { ...working };
    delete next[id];
    history.push(next);
  }

  async function save(force = false) {
    setSaving(true);
    setError(undefined);
    try {
      const base = force && conflict ? conflict : savedRevision;
      await api(`/variations/${v.id}/overrides`, { method: "PUT", body: { overrides: working, baseRevision: base } });
      setSavedOverrides(working); // keep the editor clean even before the reload lands
      setConflict(null);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") {
        const current = await api<EditData>(`/variations/${v.id}/edit`).then((x) => x.variation.revision).catch(() => null);
        setConflict(current);
      } else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function restore(revision: number) {
    if (dirty && !confirm("Restoring discards your unsaved edits. Continue?")) return;
    try {
      await api(`/variations/${v.id}/revisions/${revision}/restore`, { method: "POST", body: { baseRevision: savedRevision } });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Keyboard: undo/redo, save, nudge, deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]");
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) void save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history.redo();
      } else if (e.key === "Escape") setSelected(undefined);
      else if (layer && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        apply([{ op: "set_geometry", target: { layerId: layer.id }, x: layer.x + dx, y: layer.y + dy }], `nudge:${layer.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const dims = changedDimensions(diffs);

  return (
    <>
      <TopBar
        crumbs={[
          { label: "Projects", href: "/" },
          { label: projectName ?? "…", href: `/projects/${data.campaign.projectId}` },
          { label: data.campaign.name, href: `/campaigns/${data.campaign.id}` },
          { label: v.name },
        ]}
      >
        <span className="hidden text-xs text-zinc-500 lg:inline">
          Version {savedRevision}
          {dirty ? " · unsaved changes" : " · saved"}
        </span>
        <Button size="sm" variant="ghost" onClick={history.undo} disabled={!history.canUndo} title="Undo (Cmd/Ctrl+Z)">
          Undo
        </Button>
        <Button size="sm" variant="ghost" onClick={history.redo} disabled={!history.canRedo} title="Redo (Shift+Cmd/Ctrl+Z)">
          Redo
        </Button>
        <Button size="sm" variant="ghost" onClick={() => history.push({})} disabled={Object.keys(working).length === 0} title="Remove every change and show the original design">
          Reset all
        </Button>
        <Button variant="primary" onClick={() => save()} disabled={!dirty || saving} title="Save (Cmd/Ctrl+S)">
          {saving ? "Saving…" : "Save"}
        </Button>
      </TopBar>

      {conflict !== null && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>This variation was changed elsewhere (now version {conflict}), probably by the agent. Saving now would replace that change.</span>
          <Button size="sm" onClick={() => reload()}>
            Discard my edits and load version {conflict}
          </Button>
          <Button size="sm" variant="danger" onClick={() => save(true)}>
            Save mine anyway
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside aria-label="Layers panel" className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-3 py-2">
            <p className="truncate text-xs text-zinc-500">
              {data.direction.name} · built from {design.name}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={v.status} />
              <span className="text-xs text-zinc-500">
                {design.width}×{design.height}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <LayerPanel
              layers={layers}
              selected={selected}
              changed={changedIds}
              onSelect={setSelected}
              onToggleVisible={(l) => apply([{ op: "set_visibility", target: { layerId: l.id }, visible: !l.visible }])}
              onReorder={(lid, position) => apply([{ op: "reorder", target: { layerId: lid }, position }])}
            />
          </div>
        </aside>

        <main className="preview-empty flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-8">
            <EditorCanvas
              doc={doc}
              selected={selected}
              onSelect={setSelected}
              onOverflow={setOverflow}
              onMove={(lid, dx, dy) => {
                const l = getLayer(doc, lid);
                if (l) apply([{ op: "set_geometry", target: { layerId: lid }, x: l.x + dx, y: l.y + dy }]);
              }}
            />
          </div>
          <div className="space-y-1 border-t border-zinc-200 bg-white/90 px-4 py-2 text-xs">
            {error && <ErrorNote>{error}</ErrorNote>}
            {overflow.length > 0 && <p className="text-amber-800">Text doesn't fit its box: {overflow.join(", ")}. Shorten it, make the box bigger or the font smaller.</p>}
            {warnings.filter((w) => !/overflow/.test(w)).map((w) => (
              <p key={w} className="text-amber-800">
                {w}
              </p>
            ))}
            <p className="text-zinc-600">
              {dims.length === 0 ? "Identical to the original design." : `Changed from the original: ${dims.map(dimensionLabel).join(", ")}.`} The original design is never modified.
            </p>
          </div>
        </main>

        <aside aria-label="Edit panel" className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-white">
          <div role="tablist" className="flex shrink-0 border-b border-zinc-200 px-2">
            {(
              [
                ["element", "Element"],
                ["history", `History (${data.revisions.length})`],
                ["ask", "Ask agent"],
              ] as const
            ).map(([p, label]) => (
              <button
                key={p}
                role="tab"
                type="button"
                aria-selected={panel === p}
                onClick={() => setPanel(p)}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${panel === p ? "border-accent text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {panel === "element" &&
              (layer && info ? (
                <PropertiesPanel
                  key={layer.id}
                  info={info}
                  layer={layer}
                  diffs={diffs.filter((x) => x.layerId === layer.id)}
                  images={images}
                  fonts={fonts}
                  apply={apply}
                  {...(changedIds.has(layer.id) ? { onReset: () => resetLayer(layer.id) } : {})}
                />
              ) : (
                <div className="space-y-2 text-sm text-zinc-600">
                  <p>Click an element on the ad, or pick one from the layers list, to edit it.</p>
                  <p className="text-xs text-zinc-500">Edits are checked by the same rules as the agent's. Save to keep them; every save becomes a version you can return to.</p>
                </div>
              ))}
            {panel === "history" && <History revisions={data.revisions} current={savedRevision} onRestore={restore} />}
            {panel === "ask" && <AskAgent campaignId={data.campaign.id} variationId={v.id} variationName={v.name} />}
          </div>
        </aside>
      </div>
    </>
  );
}

function History({ revisions, current, onRestore }: { revisions: EditData["revisions"]; current: number; onRestore: (r: number) => void }) {
  if (revisions.length === 0) return <p className="text-sm text-zinc-500">No saved versions yet.</p>;
  return (
    <ol className="space-y-3">
      {revisions.map((r) => (
        <li key={r.revision} className="rounded-md border border-zinc-200 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-zinc-900">
              Version {r.revision}
              {r.revision === current ? " · current" : ""}
            </span>
            <span className="text-zinc-500">{timeAgo(r.createdAt)}</span>
          </div>
          <p className="mt-0.5 text-zinc-600">
            {r.editedBy === "agent" ? "By the agent" : "By you"}
            {r.dimensions?.length ? ` · ${r.dimensions.map(dimensionLabel).join(", ")}` : ""}
          </p>
          {r.note && <p className="mt-1 text-zinc-800">{r.note}</p>}
          {r.revision !== current && (
            <Button size="sm" className="mt-2" onClick={() => onRestore(r.revision)}>
              Restore this version
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

function AskAgent({ campaignId, variationId, variationName }: { campaignId: string; variationId: string; variationName: string }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  async function send() {
    if (!text.trim()) return;
    try {
      await api(`/campaigns/${campaignId}/messages`, { method: "POST", body: { text: `About “${variationName}”: ${text.trim()}`, variationId } });
      setText("");
      setSent(true);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-zinc-600">Ask the agent to change this ad, e.g. “try three shorter headlines” or “make the CTA stand out more”. It sees which ad you mean.</p>
      <textarea aria-label="Message to the agent about this variation" className={`${inputClass} resize-y`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={!text.trim()} onClick={send}>
          Send to agent
        </Button>
        {sent && <span className="text-xs text-emerald-700">Sent. It appears in the campaign's agent panel.</span>}
      </div>
    </div>
  );
}
