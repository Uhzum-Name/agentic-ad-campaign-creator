"use client";

import { type ChangeEvent, useRef, useState } from "react";
import { type ProjectImage, api, assetUrl, uploadImageFile, useResource } from "../lib/api";
import { Button, ErrorNote } from "./ui";

/** Images available to swap into variations. */
export function ImageLibrary({ projectId }: { projectId: string }) {
  const images = useResource<ProjectImage[]>(`/projects/${projectId}/images`);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<string[]>([]);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    const problems: string[] = [];
    for (const file of files) {
      setBusy(`Uploading ${file.name}…`);
      try {
        await uploadImageFile(projectId, file);
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(undefined);
    setErrors(problems);
    await images.refresh();
  }

  async function remove(id: string) {
    try {
      await api(`/images/${id}`, { method: "DELETE" });
      await images.refresh();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  }

  return (
    <section aria-labelledby="images-title" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="images-title" className="text-lg font-semibold">
            Images
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-600">Product shots, photos and backgrounds the agent can swap into variations. PNG, JPEG, GIF, WebP or SVG, up to 4 MB.</p>
        </div>
        <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="hidden" onChange={onFiles} aria-label="Image files" />
        <Button variant="primary" disabled={busy !== undefined} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Upload images"}
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-xs text-zinc-600">
          {busy}
        </p>
      )}
      {errors.length > 0 && (
        <ErrorNote>
          {errors.map((e) => (
            <span key={e} className="block">
              {e}
            </span>
          ))}
        </ErrorNote>
      )}
      {images.error && <ErrorNote>{images.error.message}</ErrorNote>}
      {images.data?.length === 0 && <p className="text-sm text-zinc-500">No images uploaded. Images already in the project's designs can be used too.</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {images.data?.map((img) => (
          <li key={img.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="preview-empty flex h-28 items-center justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(img.assetKey)} alt={img.name} className="max-h-full max-w-full object-contain" />
            </div>
            <div className="flex items-center gap-1 border-t border-zinc-100 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs" title={img.name}>
                {img.name}
              </span>
              {img.width && img.height && <span className="shrink-0 text-[10px] text-zinc-400">{img.width}×{img.height}</span>}
              <button type="button" onClick={() => remove(img.id)} aria-label={`Remove ${img.name}`} className="rounded px-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-700">
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
