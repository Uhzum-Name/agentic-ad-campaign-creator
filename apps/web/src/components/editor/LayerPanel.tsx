"use client";

import type { LayerInfo } from "@adengine/design";

/** The layer tree, back to front as in the design, with visibility and order controls. */
export function LayerPanel({
  layers,
  selected,
  changed,
  onSelect,
  onToggleVisible,
  onReorder,
}: {
  layers: LayerInfo[];
  selected?: string;
  changed: Set<string>;
  onSelect: (id: string) => void;
  onToggleVisible: (layer: LayerInfo) => void;
  onReorder: (id: string, position: "forward" | "backward") => void;
}) {
  // Front-most at the top of the list, like most design tools.
  const ordered = [...layers].reverse();
  return (
    <ul aria-label="Layers" className="py-1 text-sm">
      {ordered.map((l) => {
        const isSel = selected === l.id;
        return (
          <li key={l.id} className={`group flex items-center gap-1 pr-2 ${isSel ? "bg-indigo-50" : "hover:bg-zinc-50"}`} style={{ paddingLeft: 8 + l.depth * 14 }}>
            <button type="button" onClick={() => onToggleVisible(l)} aria-label={`${l.visible ? "Hide" : "Show"} ${l.name}`} className="shrink-0 rounded px-1 text-xs text-zinc-400 hover:text-zinc-800">
              {l.visible ? "◉" : "○"}
            </button>
            <button type="button" onClick={() => onSelect(l.id)} aria-pressed={isSel} className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left ${l.visible ? "" : "text-zinc-400"}`}>
              <span className="w-9 shrink-0 text-[9px] font-medium uppercase tracking-wide text-zinc-400">{l.type}</span>
              <span className={`min-w-0 flex-1 truncate ${isSel ? "font-medium text-indigo-900" : ""}`}>{l.name}</span>
              {changed.has(l.id) && <span title="Changed from the original" className="size-1.5 shrink-0 rounded-full bg-indigo-500" />}
            </button>
            <span className="hidden shrink-0 gap-0.5 group-hover:flex">
              <button type="button" onClick={() => onReorder(l.id, "forward")} aria-label={`Bring ${l.name} forward`} className="rounded px-1 text-xs text-zinc-500 hover:bg-zinc-200">
                ↑
              </button>
              <button type="button" onClick={() => onReorder(l.id, "backward")} aria-label={`Send ${l.name} backward`} className="rounded px-1 text-xs text-zinc-500 hover:bg-zinc-200">
                ↓
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
