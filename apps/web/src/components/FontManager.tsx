"use client";

import { type ChangeEvent, useRef, useState } from "react";
import { api, uploadFontFile } from "../lib/api";
import { useProjectFonts } from "./ProjectFonts";
import { Button, ErrorNote } from "./ui";

const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra Bold", 900: "Black" };

/** Upload and manage a project's brand fonts. Must be inside ProjectFontsProvider. */
export function FontManager({ projectId }: { projectId: string }) {
  const { fonts, refresh } = useProjectFonts();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    setErrors([]);
    setNotice(undefined);
    const problems: string[] = [];
    let added = 0;
    for (const file of files) {
      setBusy(`Uploading ${file.name}…`);
      try {
        await uploadFontFile(projectId, file);
        added++;
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(undefined);
    setErrors(problems);
    if (added) setNotice(`${added} font file${added === 1 ? "" : "s"} uploaded.`);
    await refresh();
  }

  async function remove(id: string) {
    setErrors([]);
    try {
      await api(`/fonts/${id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  }

  const families = new Map<string, NonNullable<typeof fonts>>();
  for (const f of fonts ?? []) families.set(f.family, [...(families.get(f.family) ?? []), f]);

  return (
    <section aria-labelledby="fonts-title" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="fonts-title" className="text-lg font-semibold">
            Brand fonts
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-600">
            Upload the font files your designs use (.woff2, .woff, .otf or .ttf). They are matched to designs by family name and used in every preview and export. Check that the font licence allows embedding in ads.
          </p>
        </div>
        <input ref={input} type="file" multiple accept=".woff2,.woff,.otf,.ttf,font/woff2,font/woff,font/otf,font/ttf" className="hidden" onChange={onFiles} aria-label="Font files" />
        <Button variant="primary" disabled={busy !== undefined} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Upload fonts"}
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-xs text-zinc-600">
          {busy}
        </p>
      )}
      {notice && !busy && (
        <p role="status" className="text-xs text-emerald-700">
          {notice}
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
      {fonts?.length === 0 && <p className="text-sm text-zinc-500">No fonts uploaded. Designs use Google Fonts where available, or a substitute font.</p>}
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
        {[...families].map(([family, faces]) => (
          <li key={family} className="px-4 py-3">
            <p className="text-sm font-medium" style={{ fontFamily: `'${family}', system-ui` }}>
              {family}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {faces.map((f) => (
                <li key={f.id} className="flex items-center gap-1 rounded-md border border-zinc-200 py-0.5 pl-2 pr-0.5 text-xs text-zinc-700">
                  <span style={{ fontFamily: `'${family}', system-ui`, fontWeight: f.weight, fontStyle: f.style }}>
                    {WEIGHT_NAMES[f.weight] ?? f.weight}
                    {f.style === "italic" ? " Italic" : ""}
                  </span>
                  <span className="text-zinc-400">{f.weight}</span>
                  <button type="button" onClick={() => remove(f.id)} aria-label={`Remove ${family} ${f.weight}${f.style === "italic" ? " italic" : ""}`} className="rounded px-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-700">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
