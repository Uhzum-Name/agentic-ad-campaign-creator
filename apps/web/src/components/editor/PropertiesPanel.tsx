"use client";

import type { Layer } from "@adengine/core/design";
import type { VariationChange } from "@adengine/core/variations";
import type { LayerDifference, LayerInfo } from "@adengine/design";
import { assetUrl } from "../../lib/api";
import { dimensionLabel } from "../VariationCard";
import { Button } from "../ui";
import { ColorField, NumberField, Row, Segmented, TextField, Toggle } from "./fields";

export interface ImageChoice {
  assetKey: string;
  name: string;
  source: "library" | "design";
}

const WEIGHTS: [string, string][] = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => [String(w), String(w)]);

/** Edits for the selected element. Every edit is a change the engine validates, the same kind the agent makes. */
export function PropertiesPanel({
  info,
  layer,
  diffs,
  images,
  fonts,
  apply,
  onReset,
}: {
  info: LayerInfo;
  layer: Layer;
  diffs: LayerDifference[];
  images: ImageChoice[];
  fonts: string[];
  apply: (changes: VariationChange[], coalesceKey?: string) => void;
  onReset?: () => void;
}) {
  const target = { layerId: layer.id };
  const geometry = (k: "x" | "y" | "width" | "height", v: number) => apply([{ op: "set_geometry", target, [k]: v }]);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{layer.name}</h2>
            <p className="text-xs text-zinc-500">
              {layer.type}
              {info.role ? ` · ${info.role}` : ""}
            </p>
          </div>
          {onReset && (
            <Button size="sm" variant="ghost" onClick={onReset} title="Undo every change to this element in this variation">
              Reset to original
            </Button>
          )}
        </div>
        {diffs.length > 0 && (
          <ul className="mt-2 space-y-0.5 rounded-md bg-indigo-50/60 px-2 py-1.5 text-[11px] text-indigo-900">
            {diffs.map((d, i) => (
              <li key={i} className="truncate" title={`${d.before} → ${d.after}`}>
                {dimensionLabel(d.dimension) === d.field ? d.field : `${dimensionLabel(d.dimension)} · ${d.field}`}: <span className="text-zinc-500 line-through">{d.before.replace(/\n/g, " ")}</span> → {d.after.replace(/\n/g, " ")}
              </li>
            ))}
          </ul>
        )}
      </div>

      {layer.type === "text" && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Text</h3>
          <TextField label="Text content" multiline value={layer.text} onCommit={(text) => apply([{ op: "set_text", target, text }])} />
          <p className="text-[10px] text-zinc-400">Applies when you click away · Cmd/Ctrl+Enter</p>
          <Row label="Font">
            <TextField label="Font family" list="editor-fonts" value={layer.style.fontFamily} onCommit={(fontFamily) => fontFamily.trim() && apply([{ op: "set_text_style", target, style: { fontFamily: fontFamily.trim() } }])} />
            <datalist id="editor-fonts">
              {fonts.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Row>
          <Row label="Size">
            <NumberField label="Font size" min={1} max={500} value={layer.style.fontSize} onCommit={(fontSize) => apply([{ op: "set_text_style", target, style: { fontSize } }])} />
          </Row>
          <Row label="Weight">
            <select
              aria-label="Font weight"
              className="h-7 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs"
              value={String(layer.style.fontWeight)}
              onChange={(e) => apply([{ op: "set_text_style", target, style: { fontWeight: Number(e.target.value) } }])}
            >
              {WEIGHTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Line height">
            <NumberField label="Line height" min={0.5} max={5} step={0.05} value={layer.style.lineHeight ?? 1.2} onCommit={(lineHeight) => apply([{ op: "set_text_style", target, style: { lineHeight } }])} />
          </Row>
          <Row label="Colour">
            <ColorField label="Text colour" value={layer.style.color} onCommit={(color, live) => apply([{ op: "set_text_style", target, style: { color } }], live ? `color:${layer.id}` : undefined)} />
          </Row>
          <Row label="Align">
            <Segmented label="Horizontal alignment" value={layer.style.align} options={[["left", "Left"], ["center", "Centre"], ["right", "Right"]]} onChange={(align) => apply([{ op: "set_text_style", target, style: { align } }])} />
          </Row>
          <Row label="Vertical">
            <Segmented label="Vertical alignment" value={layer.style.verticalAlign} options={[["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]]} onChange={(verticalAlign) => apply([{ op: "set_text_style", target, style: { verticalAlign } }])} />
          </Row>
          <div className="flex flex-wrap gap-1 pl-[80px]">
            <Toggle label="Italic" checked={layer.style.italic} onChange={(italic) => apply([{ op: "set_text_style", target, style: { italic } }])} />
            <Toggle label="Underline" checked={layer.style.underline} onChange={(underline) => apply([{ op: "set_text_style", target, style: { underline } }])} />
            <Toggle label="UPPERCASE" checked={layer.style.transform === "uppercase"} onChange={(on) => apply([{ op: "set_text_style", target, style: { transform: on ? "uppercase" : "none" } }])} />
          </div>
          {layer.runs?.length ? <p className="text-[11px] text-amber-800">This text has styled parts (e.g. a coloured link). Changing the wording removes them.</p> : null}
        </section>
      )}

      {layer.type === "image" && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Image</h3>
          <Row label="Fit">
            <Segmented label="Image fit" value={layer.fit} options={[["cover", "Fill"], ["contain", "Fit"], ["fill", "Stretch"]]} onChange={(fit) => apply([{ op: "replace_image", target, assetKey: layer.assetKey, fit }])} />
          </Row>
          {layer.crop && <p className="text-[11px] text-zinc-500">Cropped as in the original design. Changing fit or picture removes the crop.</p>}
          <p className="text-xs text-zinc-600">Replace with:</p>
          {images.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No other images. Upload some on the project page.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-1.5">
              {images.map((img) => (
                <li key={img.assetKey}>
                  <button
                    type="button"
                    title={`${img.name}${img.source === "design" ? " (from a design)" : ""}`}
                    aria-label={`Use image ${img.name}`}
                    aria-pressed={layer.assetKey === img.assetKey}
                    onClick={() => layer.assetKey !== img.assetKey && apply([{ op: "replace_image", target, assetKey: img.assetKey }])}
                    className={`preview-empty flex h-14 w-full items-center justify-center rounded border p-1 ${layer.assetKey === img.assetKey ? "border-accent ring-2 ring-accent/30" : "border-zinc-200 hover:border-zinc-400"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl(img.assetKey)} alt="" className="max-h-full max-w-full object-contain" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(layer.type === "shape" || layer.type === "group") && (layer.type === "shape" || layer.fill) && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Fill</h3>
          {layer.fill?.type === "linear-gradient" ? (
            <div className="space-y-1">
              <p className="text-[11px] text-zinc-600">Gradient: {layer.fill.stops.map((s) => s.color).join(" → ")}</p>
              <Button size="sm" onClick={() => apply([{ op: "set_fill", target, fill: { type: "solid", color: layer.fill!.type === "linear-gradient" ? layer.fill!.stops[0]!.color : "#000000" } }])}>
                Use a solid colour
              </Button>
            </div>
          ) : (
            <Row label="Colour">
              <ColorField label="Fill colour" value={layer.fill?.type === "solid" ? layer.fill.color : "transparent"} onCommit={(color, live) => apply([{ op: "set_fill", target, fill: { type: "solid", color } }], live ? `fill:${layer.id}` : undefined)} />
            </Row>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Position and size</h3>
        <div className="grid grid-cols-2 gap-2">
          <Row label="X">
            <NumberField label="X position" value={layer.x} onCommit={(v) => geometry("x", v)} />
          </Row>
          <Row label="Y">
            <NumberField label="Y position" value={layer.y} onCommit={(v) => geometry("y", v)} />
          </Row>
          <Row label="Width">
            <NumberField label="Width" min={1} value={layer.width} onCommit={(v) => geometry("width", v)} />
          </Row>
          <Row label="Height">
            <NumberField label="Height" min={1} value={layer.height} onCommit={(v) => geometry("height", v)} />
          </Row>
        </div>
        <p className="text-[10px] text-zinc-400">Relative to {info.parentId ? "its group" : "the canvas"}. Drag on the canvas, or use arrow keys (Shift for 10px).</p>
        <Row label="Opacity">
          <span className="flex items-center gap-2">
            <input
              aria-label="Opacity"
              type="range"
              min={0}
              max={100}
              value={Math.round(layer.opacity * 100)}
              onChange={(e) => apply([{ op: "set_opacity", target, opacity: Number(e.target.value) / 100 }], `opacity:${layer.id}`)}
              className="min-w-0 flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-8 text-right text-[11px] text-zinc-600">{Math.round(layer.opacity * 100)}%</span>
          </span>
        </Row>
        <Row label="Visible">
          <Toggle label={layer.visible ? "Shown" : "Hidden"} checked={layer.visible} onChange={(visible) => apply([{ op: "set_visibility", target, visible }])} />
        </Row>
      </section>
    </div>
  );
}
