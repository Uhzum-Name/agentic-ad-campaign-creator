"use client";

import type { Layer } from "@adengine/core/design";
import { type DesignSummary, type LayerInfo, getLayer, listLayers } from "@adengine/design";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DesignPreview } from "../../../components/DesignPreview";
import { EmptyState, ErrorNote, Skeleton, TopBar } from "../../../components/ui";
import { type Design, type Project, assetUrl, useResource } from "../../../lib/api";

type View = "ours" | "reference" | "both";

export default function DesignPage() {
  const { id } = useParams<{ id: string }>();
  const design = useResource<Design & { summary: DesignSummary }>(`/designs/${id}`);
  const project = useResource<Project>(design.data ? `/projects/${design.data.projectId}` : null);
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<View>("ours");

  const layers = useMemo(() => (design.data ? listLayers(design.data.document) : []), [design.data]);
  const selectedInfo = layers.find((l) => l.id === selected);
  const selectedLayer = design.data && selected ? getLayer(design.data.document, selected) : undefined;

  if (design.error?.status === 404) {
    return (
      <div className="flex min-h-full flex-col">
        <TopBar crumbs={[{ label: "Projects", href: "/" }]} />
        <main className="mx-auto w-full max-w-3xl px-4 py-8">
          <EmptyState title="Design not found" action={<Link className="text-sm font-medium text-accent" href="/">Back to projects</Link>}>
            It may have been deleted.
          </EmptyState>
        </main>
      </div>
    );
  }

  const d = design.data;
  const report = d?.importReport;
  const notes = [...(report?.warnings ?? []), ...(report?.skipped ?? []).map((s) => `"${s.name}" was skipped: ${s.reason}.`)];

  return (
    <div className="flex h-full flex-col">
      <TopBar
        crumbs={[
          { label: "Projects", href: "/" },
          { label: project.data?.name ?? "…", href: d ? `/projects/${d.projectId}` : undefined },
          { label: d?.name ?? "…" },
        ]}
      >
        {d?.referenceAssetKey && (
          <div role="group" aria-label="Compare with Figma" className="flex rounded-md border border-zinc-300 bg-white p-0.5">
            {(
              [
                ["ours", "Our render"],
                ["reference", "Figma render"],
                ["both", "Side by side"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded px-2.5 py-1 text-xs font-medium ${view === v ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </TopBar>

      {design.error && <div className="p-4"><ErrorNote>{design.error.message}</ErrorNote></div>}
      {design.loading && <div className="p-4"><Skeleton className="h-96" /></div>}

      {d && (
        <div className="flex min-h-0 flex-1">
          <main className="preview-empty flex min-w-0 flex-1 gap-6 overflow-hidden p-8">
            {view !== "reference" && (
              <figure className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="min-h-0 flex-1">
                  <DesignPreview document={d.document} maxScale={3}>
                    {selectedInfo && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute outline outline-2 outline-accent"
                        style={{ left: selectedInfo.absoluteX, top: selectedInfo.absoluteY, width: selectedInfo.width, height: selectedInfo.height }}
                      />
                    )}
                  </DesignPreview>
                </div>
                {view === "both" && <figcaption className="text-center text-xs text-zinc-600">Our render</figcaption>}
              </figure>
            )}
            {view !== "ours" && d.referenceAssetKey && (
              <figure className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetUrl(d.referenceAssetKey)} alt="Figma's render of this frame" className="max-h-full max-w-full shadow-sm ring-1 ring-black/10" />
                </div>
                {view === "both" && <figcaption className="text-center text-xs text-zinc-600">Figma render</figcaption>}
              </figure>
            )}
          </main>

          <aside aria-label="Layers" className="flex w-[340px] shrink-0 flex-col border-l border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-4 py-3">
              <h2 className="text-sm font-semibold">Layers</h2>
              <p className="text-xs text-zinc-500">
                {d.width}×{d.height} · {d.summary.layerCount} layers · {d.summary.fonts.join(", ") || "no text"}
              </p>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {layers.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    aria-pressed={selected === l.id}
                    onClick={() => setSelected(selected === l.id ? undefined : l.id)}
                    style={{ paddingLeft: 16 + l.depth * 16 }}
                    className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm ${selected === l.id ? "bg-indigo-50 text-indigo-900" : "hover:bg-zinc-50"} ${l.visible ? "" : "text-zinc-400"}`}
                  >
                    <span className="w-10 shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{l.type}</span>
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    {!l.visible && <span className="text-[10px] text-zinc-400">hidden</span>}
                    {l.role && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">{l.role}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {selectedInfo && selectedLayer && <LayerDetails info={selectedInfo} layer={selectedLayer} />}
            {(notes.length > 0 || (report?.rasterized?.length ?? 0) > 0) && (
              <details className="border-t border-zinc-200 px-4 py-3 text-xs text-zinc-600">
                <summary className="cursor-pointer text-sm font-medium text-zinc-900">
                  Import notes ({notes.length + (report?.rasterized?.length ?? 0)})
                </summary>
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-4">
                  {report?.rasterized?.map((r) => (
                    <li key={r.nodeId}>
                      “{r.name}” was imported as a flat image: {r.reason}.
                    </li>
                  ))}
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function LayerDetails({ info, layer }: { info: LayerInfo; layer: Layer }) {
  const rows: [string, string][] = [
    ["Position", `${info.absoluteX}, ${info.absoluteY}`],
    ["Size", `${info.width} × ${info.height}`],
    ...(layer.opacity !== 1 ? ([["Opacity", `${Math.round(layer.opacity * 100)}%`]] as [string, string][]) : []),
  ];
  if (layer.type === "text") {
    rows.push(["Text", layer.text], ["Font", `${layer.style.fontFamily} ${layer.style.fontWeight}, ${layer.style.fontSize}px`], ["Colour", layer.style.color], ["Align", layer.style.align]);
  } else if (layer.type === "image") {
    rows.push(["Fit", layer.fit], ["File", layer.assetKey.split("/").pop() ?? ""]);
  } else if (layer.type === "shape") {
    rows.push(["Shape", layer.shape], ["Fill", layer.fill ? (layer.fill.type === "solid" ? layer.fill.color : "Gradient") : "None"]);
    if (layer.cornerRadius) rows.push(["Corner radius", `${layer.cornerRadius}`]);
  } else {
    rows.push(["Children", `${layer.children.length}`], ["Clips content", layer.clip ? "Yes" : "No"]);
  }
  return (
    <div className="border-t border-zinc-200 px-4 py-3">
      <h3 className="truncate text-sm font-semibold">{layer.name}</h3>
      <dl className="mt-2 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-zinc-900">{v}</dd>
          </div>
        ))}
        <div className="contents">
          <dt className="text-zinc-500">Layer id</dt>
          <dd className="min-w-0 break-all font-mono text-[11px] text-zinc-700">{layer.id}</dd>
        </div>
      </dl>
    </div>
  );
}
