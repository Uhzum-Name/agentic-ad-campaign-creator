"use client";

import type { DesignDocument } from "@adengine/core/design";
import { type LayerInfo, listLayers } from "@adengine/design";
import { type PointerEvent, useMemo, useRef, useState } from "react";
import { DesignPreview } from "../DesignPreview";

/**
 * The editable canvas: the variation drawn by the engine renderer, with a
 * selection outline. Click selects the front-most element under the pointer;
 * dragging the selected element moves it.
 */
export function EditorCanvas({
  doc,
  selected,
  onSelect,
  onMove,
  onOverflow,
}: {
  doc: DesignDocument;
  selected?: string;
  onSelect: (id: string | undefined) => void;
  /** Called once when a drag ends, with the distance moved in design pixels. */
  onMove: (id: string, dx: number, dy: number) => void;
  onOverflow: (names: string[]) => void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; dx: number; dy: number } | null>(null);
  const layers = useMemo(() => listLayers(doc), [doc]);
  const sel = layers.find((l) => l.id === selected);

  const toDesign = (e: PointerEvent) => {
    const rect = overlay.current!.getBoundingClientRect();
    const scale = rect.width / doc.width;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale, scale };
  };
  const byId = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  /**
   * Like most design tools: a click selects the outermost group under the
   * pointer (e.g. the whole button); clicking again inside the selection goes
   * one level deeper (e.g. the button's label).
   */
  const hit = (x: number, y: number): LayerInfo | undefined => {
    const under = layers.filter((l) => l.visible && x >= l.absoluteX && x <= l.absoluteX + l.width && y >= l.absoluteY && y <= l.absoluteY + l.height);
    const leaves = under.filter((l) => l.type !== "group");
    const front = (leaves.length ? leaves : under).at(-1);
    if (!front) return undefined;
    const chain = [...front.path.map((id) => byId.get(id)!).filter(Boolean), front];
    const at = selected ? chain.findIndex((l) => l.id === selected) : -1;
    return at === -1 ? chain[0] : chain[Math.min(at + 1, chain.length - 1)];
  };

  const pending = useRef<string | null>(null);
  function down(e: PointerEvent) {
    const p = toDesign(e);
    const insideSelection = sel && p.x >= sel.absoluteX && p.x <= sel.absoluteX + sel.width && p.y >= sel.absoluteY && p.y <= sel.absoluteY + sel.height;
    // Pressing inside the selection may start a drag of it; a click without moving drills in on release.
    const target = insideSelection ? sel : hit(p.x, p.y);
    pending.current = insideSelection ? (hit(p.x, p.y)?.id ?? null) : null;
    if (!insideSelection) onSelect(target?.id);
    if (target) {
      overlay.current!.setPointerCapture(e.pointerId);
      setDrag({ id: target.id, startX: p.x, startY: p.y, dx: 0, dy: 0 });
    }
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const p = toDesign(e);
    setDrag({ ...drag, dx: p.x - drag.startX, dy: p.y - drag.startY });
  }
  function up() {
    const moved = drag && (Math.abs(drag.dx) >= 1 || Math.abs(drag.dy) >= 1);
    if (drag && moved) onMove(drag.id, Math.round(drag.dx), Math.round(drag.dy));
    else if (pending.current && pending.current !== selected) onSelect(pending.current);
    pending.current = null;
    setDrag(null);
  }

  const box = sel && { x: sel.absoluteX + (drag?.id === sel.id ? drag.dx : 0), y: sel.absoluteY + (drag?.id === sel.id ? drag.dy : 0), w: sel.width, h: sel.height };

  return (
    <DesignPreview document={doc} maxScale={3} onOverflow={onOverflow}>
      <div
        ref={overlay}
        role="presentation"
        className={`absolute inset-0 ${drag ? "cursor-grabbing" : "cursor-default"} touch-none`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
      >
        {box && (
          <div
            aria-hidden
            className="pointer-events-none absolute outline outline-2 outline-[#4f46e5]"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h, outlineOffset: 0 }}
          >
            {drag && (
              <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#4f46e5] px-1 text-[9px] text-white">
                {Math.round(box.x)}, {Math.round(box.y)}
              </span>
            )}
          </div>
        )}
      </div>
    </DesignPreview>
  );
}
