"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { type Campaign, type Design, type Variation, type Workspace, api, useResource } from "../lib/api";
import { PRESET_SIZES } from "../lib/sizes";
import { Button, ErrorNote, inputClass } from "./ui";

const NEW_DIRECTION = "__new__";

/**
 * Creates a variation from a design in one of the project's campaigns. The
 * design itself is not changed; the variation records it as its source.
 */
export function UseInCampaign({ design, onDone, onCancel }: { design: Design; onDone: () => Promise<void>; onCancel: () => void }) {
  const campaigns = useResource<Campaign[]>(`/projects/${design.projectId}/campaigns`);
  const [campaignId, setCampaignId] = useState("");
  const workspace = useResource<Workspace>(campaignId ? `/campaigns/${campaignId}/workspace` : null);
  const [directionId, setDirectionId] = useState("");
  const [directionName, setDirectionName] = useState("");
  const [name, setName] = useState(`${design.name} — original`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ campaignId: string; campaignName: string }>();

  // Default to the first campaign, and to its first direction (or a new one if it has none).
  useEffect(() => {
    if (!campaignId && campaigns.data?.[0]) setCampaignId(campaigns.data[0].id);
  }, [campaigns.data, campaignId]);
  useEffect(() => {
    const directions = workspace.data?.directions;
    if (!directions) return;
    // Keep the current choice if it still exists (e.g. a direction just created).
    setDirectionId((current) => (current === NEW_DIRECTION || directions.some((d) => d.id === current) ? current : (directions[0]?.id ?? NEW_DIRECTION)));
  }, [workspace.data]);

  const creatingDirection = directionId === NEW_DIRECTION;
  const ready = campaignId && directionId && name.trim() && (!creatingDirection || directionName.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      let target = directionId;
      if (creatingDirection) {
        const direction = await api<{ id: string }>(`/campaigns/${campaignId}/directions`, { method: "POST", body: { name: directionName.trim() } });
        target = direction.id;
      }
      await api<Variation>(`/directions/${target}/variations`, {
        method: "POST",
        body: { name: name.trim(), sourceDesignId: design.id, sizes: PRESET_SIZES },
      });
      setDirectionId(target);
      setDirectionName("");
      await workspace.refresh();
      setCreated({ campaignId, campaignName: campaigns.data?.find((c) => c.id === campaignId)?.name ?? "the campaign" });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm text-zinc-700">
          Added to <span className="font-medium">{created.campaignName}</span>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/campaigns/${created.campaignId}`} className="inline-flex h-9 items-center whitespace-nowrap rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong">
            Open campaign
          </Link>
          <Button onClick={() => setCreated(undefined)}>Add another</Button>
          <Button variant="ghost" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (campaigns.data?.length === 0) {
    return (
      <div className="space-y-3 text-sm text-zinc-700">
        <p>This project has no campaigns yet. Create one on the project page, then come back to add this design to it.</p>
        <div className="flex gap-2">
          <Link href={`/projects/${design.projectId}`} className="inline-flex h-9 items-center whitespace-nowrap rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong">
            Go to project
          </Link>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1 text-xs font-medium text-zinc-700">
        <span>Campaign</span>
        <select className={`${inputClass} h-9 py-0`} value={campaignId} onChange={(e) => {
            setCampaignId(e.target.value);
            setDirectionId("");
          }} disabled={!campaigns.data}>
          {campaigns.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-xs font-medium text-zinc-700">
        <span>Creative direction</span>
        <select className={`${inputClass} h-9 py-0`} value={directionId} onChange={(e) => setDirectionId(e.target.value)} disabled={!workspace.data}>
          {workspace.data?.directions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={NEW_DIRECTION}>New direction…</option>
        </select>
      </label>
      {creatingDirection && (
        <input aria-label="New direction name" className={inputClass} value={directionName} onChange={(e) => setDirectionName(e.target.value)} placeholder="Name the new direction" maxLength={200} />
      )}
      <label className="block space-y-1 text-xs font-medium text-zinc-700">
        <span>Variation name</span>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </label>
      <p className="text-xs text-zinc-500">Created in the five standard sizes. The original design is not changed.</p>
      {(error || campaigns.error) && <ErrorNote>{error ?? campaigns.error!.message}</ErrorNote>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!ready || busy}>
          {busy ? "Adding…" : "Add to campaign"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
