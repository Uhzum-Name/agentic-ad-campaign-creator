"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreateForm } from "../components/CreateForm";
import { EmptyState, ErrorNote, Skeleton, TopBar } from "../components/ui";
import { type Project, api, timeAgo, useResource } from "../lib/api";

export default function ProjectsPage() {
  const router = useRouter();
  const projects = useResource<Project[]>("/projects");

  async function create(name: string) {
    const project = await api<Project>("/projects", { method: "POST", body: { name } });
    router.push(`/projects/${project.id}`);
  }

  return (
    <div className="flex min-h-full flex-col">
      <TopBar crumbs={[{ label: "Projects" }]} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-zinc-600">A project holds the campaigns, designs and assets for one brand or client.</p>
        </div>
        <CreateForm label="Project name" placeholder="New project name" submitLabel="Create project" onCreate={create} />
        {projects.error && <ErrorNote>{projects.error.message}</ErrorNote>}
        {projects.loading && (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        )}
        {projects.data?.length === 0 && <EmptyState title="No projects yet">Name your first project above to get started.</EmptyState>}
        <ul className="space-y-2">
          {projects.data?.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-400">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-xs text-zinc-500">Created {timeAgo(p.createdAt)}</span>
                </span>
                <span className="shrink-0 text-sm text-zinc-600">
                  {p.campaignCount} campaign{p.campaignCount === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
