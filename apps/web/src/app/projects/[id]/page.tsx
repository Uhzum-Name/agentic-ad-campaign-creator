"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CreateForm } from "../../../components/CreateForm";
import { DesignLibrary } from "../../../components/DesignLibrary";
import { EmptyState, ErrorNote, Skeleton, StatusBadge, TopBar } from "../../../components/ui";
import { type Campaign, type Project, api, timeAgo, useResource } from "../../../lib/api";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useResource<Project>(`/projects/${id}`);
  const campaigns = useResource<Campaign[]>(`/projects/${id}/campaigns`);

  async function create(name: string) {
    const campaign = await api<Campaign>(`/projects/${id}/campaigns`, { method: "POST", body: { name } });
    router.push(`/campaigns/${campaign.id}`);
  }

  if (project.error?.status === 404) {
    return (
      <div className="flex min-h-full flex-col">
        <TopBar crumbs={[{ label: "Projects", href: "/" }]} />
        <main className="mx-auto w-full max-w-3xl px-4 py-8">
          <EmptyState title="Project not found" action={<Link className="text-sm font-medium text-accent" href="/">Back to projects</Link>}>
            It may have been deleted.
          </EmptyState>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <TopBar crumbs={[{ label: "Projects", href: "/" }, { label: project.data?.name ?? "…" }]} />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold">{project.data?.name ?? <Skeleton className="h-7 w-48" />}</h1>
          <p className="mt-1 text-sm text-zinc-600">Campaigns and source designs in this project.</p>
        </div>
        <CreateForm label="Campaign name" placeholder="New campaign name" submitLabel="Create campaign" onCreate={create} />
        {(project.error || campaigns.error) && <ErrorNote>{(project.error ?? campaigns.error)!.message}</ErrorNote>}
        {campaigns.loading && <Skeleton className="h-16" />}
        {campaigns.data?.length === 0 && <EmptyState title="No campaigns yet">Create a campaign to open its workspace.</EmptyState>}
        <ul className="space-y-2">
          {campaigns.data?.map((c) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-400">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-xs text-zinc-500">Updated {timeAgo(c.updatedAt)}</span>
                </span>
                <StatusBadge status={c.status} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-zinc-200 pt-6">
          <DesignLibrary projectId={id} />
        </div>
      </main>
    </div>
  );
}
