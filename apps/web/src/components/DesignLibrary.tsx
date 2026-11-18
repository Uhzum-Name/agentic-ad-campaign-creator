"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { type Design, type Job, api, useResource, waitForJob } from "../lib/api";
import { DesignPreview } from "./DesignPreview";
import { Button, EmptyState, ErrorNote, Skeleton, inputClass } from "./ui";

interface FixtureInfo {
  name: string;
  title: string;
  description: string;
}

/** A project's designs: the list, sample designs, and Figma import. */
export function DesignLibrary({ projectId }: { projectId: string }) {
  const designs = useResource<Design[]>(`/projects/${projectId}/designs`);
  const fixtures = useResource<FixtureInfo[]>("/design-fixtures");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [figmaUrl, setFigmaUrl] = useState("");
  const [progress, setProgress] = useState<string>();

  async function addSample(fixture: string) {
    setBusy(fixture);
    setError(undefined);
    try {
      await api(`/projects/${projectId}/designs/from-fixture`, { method: "POST", body: { fixture } });
      await designs.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function importFigma(event: FormEvent) {
    event.preventDefault();
    if (!figmaUrl.trim() || busy) return;
    setBusy("figma");
    setError(undefined);
    setProgress("Starting…");
    try {
      const job = await api<Job>(`/projects/${projectId}/designs/import-figma`, { method: "POST", body: { url: figmaUrl.trim() } });
      const finished = await waitForJob(job, (j) => setProgress(j.progressMessage ?? "Working…"));
      if (finished.status !== "succeeded") throw new Error(finished.error?.message ?? "The import did not finish.");
      setFigmaUrl("");
      await designs.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
      setProgress(undefined);
    }
  }

  return (
    <section aria-labelledby="designs-title" className="space-y-4">
      <div>
        <h2 id="designs-title" className="text-lg font-semibold">
          Designs
        </h2>
        <p className="mt-1 text-sm text-zinc-600">The original artwork for this project. Open a design to use it in a campaign; variations are built from it without changing the original.</p>
      </div>

      <form onSubmit={importFigma} className="space-y-2">
        <div className="flex gap-2">
          <input
            aria-label="Figma frame link"
            className={inputClass}
            value={figmaUrl}
            onChange={(e) => setFigmaUrl(e.target.value)}
            placeholder="Paste a Figma frame link (select the frame, then Copy link to selection)"
          />
          <Button type="submit" variant="primary" disabled={!figmaUrl.trim() || busy !== undefined} className="shrink-0">
            {busy === "figma" ? "Importing…" : "Import from Figma"}
          </Button>
        </div>
        {progress && (
          <p role="status" className="text-xs text-zinc-600">
            {progress}
          </p>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <span>Or add a sample:</span>
        {fixtures.data?.map((f) => (
          <Button key={f.name} size="sm" title={f.description} disabled={busy !== undefined} onClick={() => addSample(f.name)}>
            {busy === f.name ? "Adding…" : f.title}
          </Button>
        ))}
      </div>

      {(error || designs.error) && <ErrorNote>{error ?? designs.error!.message}</ErrorNote>}
      {designs.loading && <Skeleton className="h-40" />}
      {designs.data?.length === 0 && <EmptyState title="No designs yet">Import a frame from Figma or add a sample design to start.</EmptyState>}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {designs.data?.map((d) => (
          <li key={d.id}>
            <Link href={`/designs/${d.id}`} className="block overflow-hidden rounded-lg border border-zinc-200 bg-white hover:border-zinc-400">
              <div className="preview-empty h-40 p-3">
                <DesignPreview document={d.document} />
              </div>
              <div className="border-t border-zinc-100 px-3 py-2">
                <span className="block truncate text-sm font-medium">{d.name}</span>
                <span className="text-xs text-zinc-500">
                  {d.width}×{d.height} · {d.source.kind === "figma" ? "Figma" : d.source.kind === "fixture" ? "Sample" : "Added directly"}
                </span>
                <span className="block text-xs text-zinc-500">
                  {d.usageCount ? `Used in ${d.usageCount} variation${d.usageCount === 1 ? "" : "s"}` : "Not used yet"}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
