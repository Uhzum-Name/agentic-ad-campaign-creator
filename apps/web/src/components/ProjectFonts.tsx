"use client";

import { type FontFace, fontFaceCss } from "@adengine/design";
import { type ReactNode, createContext, useContext, useEffect } from "react";
import { type ProjectFont, assetUrl, useResource } from "../lib/api";

interface FontsContext {
  faces: FontFace[];
  fonts: ProjectFont[] | undefined;
  refresh: () => Promise<void>;
}

const Context = createContext<FontsContext>({ faces: [], fonts: undefined, refresh: async () => {} });

/** The project's uploaded fonts, for previews and font lists inside this provider. */
export const useProjectFonts = () => useContext(Context);

/**
 * Loads a project's uploaded brand fonts and declares them on the page, so
 * every design preview inside draws with them.
 */
export function ProjectFontsProvider({ projectId, children }: { projectId: string | undefined; children: ReactNode }) {
  const fonts = useResource<ProjectFont[]>(projectId ? `/projects/${projectId}/fonts` : null);
  const faces: FontFace[] = (fonts.data ?? []).map((f) => ({ family: f.family, weight: f.weight, style: f.style, format: f.format, assetKey: f.assetKey }));
  const css = fontFaceCss(faces, assetUrl);

  useEffect(() => {
    if (!projectId) return;
    const el = document.createElement("style");
    el.dataset.projectFonts = projectId;
    el.textContent = css;
    document.head.appendChild(el);
    return () => el.remove();
  }, [projectId, css]);

  return <Context.Provider value={{ faces, fonts: fonts.data, refresh: fonts.refresh }}>{children}</Context.Provider>;
}
