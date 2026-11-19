"use client";

import { type ReactNode, useEffect, useState } from "react";
import { inputClass } from "../ui";

/** A labelled row in the properties panel. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[72px_1fr] items-center gap-2 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

const small = `${inputClass} h-7 px-2 py-0 text-xs`;

/** A number that commits on Enter or when focus leaves, not on every keystroke. */
export function NumberField({ value, onCommit, min, max, step = 1, label }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onCommit(clamped);
    else setDraft(String(value));
  };
  return (
    <input
      aria-label={label}
      className={small}
      type="number"
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

/** Text that commits on blur (or Cmd/Ctrl+Enter for multi-line). */
export function TextField({ value, onCommit, multiline, label, list }: { value: string; onCommit: (v: string) => void; multiline?: boolean; label: string; list?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return multiline ? (
    <textarea
      aria-label={label}
      className={`${inputClass} resize-y px-2 py-1.5 text-sm`}
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && (e.currentTarget as HTMLTextAreaElement).blur()}
    />
  ) : (
    <input aria-label={label} list={list} className={small} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const toPicker = (c: string) => {
  if (!HEX.test(c)) return "#000000";
  return c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join("")}` : c.toLowerCase();
};

/** A colour: swatch picker plus the exact value as text. */
export function ColorField({ value, onCommit, label }: { value: string; onCommit: (v: string, live: boolean) => void; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        aria-label={`${label} picker`}
        type="color"
        className="h-7 w-8 shrink-0 cursor-pointer rounded border border-zinc-300 bg-white p-0.5"
        value={toPicker(value)}
        onChange={(e) => onCommit(e.target.value, true)}
      />
      <TextField label={label} value={value} onCommit={(v) => onCommit(v.trim(), false)} />
    </span>
  );
}

/** A small set of mutually exclusive buttons. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="flex rounded-md border border-zinc-300 bg-white p-0.5">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => value !== v && onChange(v)} className={`flex-1 rounded px-1.5 py-0.5 text-[11px] ${value === v ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
          {text}
        </button>
      ))}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" aria-pressed={checked} onClick={() => onChange(!checked)} className={`rounded-md border px-2 py-0.5 text-[11px] ${checked ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
      {label}
    </button>
  );
}
