"use client";

import type { DesignDocument } from "@adengine/core/design";
import { fontStylesheetUrls, renderDocument } from "@adengine/design";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../lib/api";
import { useProjectFonts } from "./ProjectFonts";

/** Adds each web-font stylesheet to the page once. */
function useFonts(doc: DesignDocument) {
  const { faces } = useProjectFonts();
  const urls = useMemo(() => fontStylesheetUrls(doc, faces), [doc, faces]);
  useEffect(() => {
    for (const url of urls) {
      if (document.head.querySelector(`link[data-ad-font="${CSS.escape(url)}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.adFont = url;
      document.head.appendChild(link);
    }
  }, [urls]);
}

/**
 * Draws a design document with the engine's renderer, scaled to fit the space
 * it is given. `maxScale` caps enlargement (1 = never larger than actual size).
 */
export function DesignPreview({
  document: doc,
  maxScale = 1,
  className = "",
  children,
  onOverflow,
}: {
  document: DesignDocument;
  maxScale?: number;
  className?: string;
  /** Overlay content, positioned in design pixels. */
  children?: ReactNode;
  /** Called with the names of text layers whose text does not fit their box. */
  onOverflow?: (layerNames: string[]) => void;
}) {
  useFonts(doc);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const html = useMemo(() => renderDocument(doc, { assetUrl }), [doc]);
  const content = useRef<HTMLDivElement>(null);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (layers: DesignDocument["layers"]) => {
      for (const l of layers) {
        m.set(l.id, l.name);
        if (l.type === "group") walk(l.children);
      }
    };
    walk(doc.layers);
    return m;
  }, [doc]);

  // Measures real text against its box once fonts have loaded: the browser is the only reliable judge of fit.
  useEffect(() => {
    if (!onOverflow || scale === null) return;
    let cancelled = false;
    const check = () => {
      if (cancelled || !content.current) return;
      const over: string[] = [];
      content.current.querySelectorAll<HTMLElement>('[data-layer-type="text"]').forEach((box) => {
        if (box.style.display === "none") return;
        const inner = box.firstElementChild as HTMLElement | null;
        if (!inner) return;
        if (inner.scrollHeight > box.clientHeight + 2 || inner.scrollWidth > box.clientWidth + 2) over.push(names.get(box.dataset.layerId ?? "") ?? "Text");
      });
      onOverflow(over);
    };
    void document.fonts.ready.then(() => setTimeout(check, 50));
    return () => {
      cancelled = true;
    };
  }, [html, scale, onOverflow, names]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setScale(Math.min(width / doc.width, height / doc.height, maxScale));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc.width, doc.height, maxScale]);

  return (
    <div ref={frame} className={`flex h-full w-full items-center justify-center overflow-hidden ${className}`}>
      {scale !== null && (
        <div style={{ width: doc.width * scale, height: doc.height * scale }} className="relative shrink-0 shadow-sm ring-1 ring-black/10">
          <div
            style={{ width: doc.width, height: doc.height, transform: `scale(${scale})`, transformOrigin: "top left" }}
            className="absolute left-0 top-0"
          >
            {/* The renderer escapes all document text and restricts style values. */}
            <div ref={content} dangerouslySetInnerHTML={{ __html: html }} />
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
