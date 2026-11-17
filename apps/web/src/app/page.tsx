"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

/*
 * Milestone 1 shell: proves the web app reaches the API and persists a project.
 * The real workspace (navigation, variation grid, agent panel) is milestone 2.
 */

interface Project {
  id: string;
  name: string;
  campaignCount: number;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? `Request failed (${res.status})`);
      setProjects(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not create the project");
      return;
    }
    setName("");
    await load();
  }

  return (
    <main>
      <h1>Projects</h1>
      <form onSubmit={create} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" required />
        <button type="submit">Create project</button>
      </form>
      {error && <p role="alert">Could not reach the API: {error}</p>}
      {projects === null && !error && <p>Loading…</p>}
      {projects?.length === 0 && <p>No projects yet.</p>}
      <ul>
        {projects?.map((p) => (
          <li key={p.id}>
            {p.name} — {p.campaignCount} campaign{p.campaignCount === 1 ? "" : "s"}
          </li>
        ))}
      </ul>
    </main>
  );
}
