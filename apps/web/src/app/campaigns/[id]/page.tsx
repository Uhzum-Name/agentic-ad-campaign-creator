"use client";

import { CAMPAIGN_STATUSES, type CampaignStatus } from "@adengine/core/entities";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AgentPanel } from "../../../components/AgentPanel";
import { VariationGrid } from "../../../components/VariationGrid";
import { EmptyState, ErrorNote, Skeleton, TopBar, statusLabel } from "../../../components/ui";
import { type Project, type Workspace, api, useResource } from "../../../lib/api";

export default function CampaignWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  // Polled so directions and variations produced by an agent appear as they are created.
  const workspace = useResource<Workspace>(`/campaigns/${id}/workspace`, 3000);
  const campaign = workspace.data?.campaign;
  const project = useResource<Project>(campaign ? `/projects/${campaign.projectId}` : null);
  const [statusError, setStatusError] = useState<string>();

  async function setStatus(status: CampaignStatus) {
    setStatusError(undefined);
    try {
      await api(`/campaigns/${id}`, { method: "PATCH", body: { status } });
      await workspace.refresh();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }

  if (workspace.error?.status === 404) {
    return (
      <div className="flex min-h-full flex-col">
        <TopBar crumbs={[{ label: "Projects", href: "/" }]} />
        <main className="mx-auto w-full max-w-3xl px-4 py-8">
          <EmptyState title="Campaign not found" action={<Link className="text-sm font-medium text-accent" href="/">Back to projects</Link>}>
            It may have been deleted.
          </EmptyState>
        </main>
      </div>
    );
  }

  const variations = workspace.data?.directions.flatMap((d) => d.variations) ?? [];
  const approved = variations.filter((v) => v.status === "approved").length;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        crumbs={[
          { label: "Projects", href: "/" },
          { label: project.data?.name ?? "…", href: campaign ? `/projects/${campaign.projectId}` : undefined },
          { label: campaign?.name ?? "…" },
        ]}
      >
        {campaign && (
          <>
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {workspace.data!.directions.length} direction{workspace.data!.directions.length === 1 ? "" : "s"} · {variations.length} variation
              {variations.length === 1 ? "" : "s"} · {approved} approved
            </span>
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              Status
              <select
                className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
                value={campaign.status}
                onChange={(e) => setStatus(e.target.value as CampaignStatus)}
              >
                {CAMPAIGN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </TopBar>

      <div className="flex min-h-0 flex-1">
        {campaign && <AgentPanel campaignId={campaign.id} brief={workspace.data!.brief} onBriefSaved={workspace.refresh} />}
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {statusError && <ErrorNote>{statusError}</ErrorNote>}
          {workspace.error && !workspace.data && <ErrorNote>{workspace.error.message}</ErrorNote>}
          {workspace.error && workspace.data && <ErrorNote>Live updates are paused: {workspace.error.message}</ErrorNote>}
          {workspace.loading && !workspace.data && (
            <div className="space-y-4">
              <Skeleton className="h-8 w-72" />
              <Skeleton className="h-64" />
            </div>
          )}
          {workspace.data && <VariationGrid workspace={workspace.data} onChange={workspace.refresh} />}
        </main>
      </div>
    </div>
  );
}
