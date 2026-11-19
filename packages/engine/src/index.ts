import type { Db } from "@adengine/db";
import type { FetchLike } from "@adengine/figma";
import { JobRegistry, defineJob, systemPingJob } from "@adengine/jobs";
import type { Storage } from "@adengine/storage";
import { z } from "zod";
import { importFigmaDesign } from "./designs.ts";

export * from "./designs.ts";
export * from "./fonts.ts";
export { FIXTURES } from "./fixtures.ts";

export interface EngineDeps {
  db: Db;
  storage: Storage;
  figma: { token: string | undefined; fetch?: FetchLike };
}

/**
 * Every job type the engine can run. The API uses it to validate and enqueue;
 * the worker (or the API itself, in inline mode) uses it to execute.
 */
export function createEngineRegistry(deps: EngineDeps): JobRegistry {
  return new JobRegistry().register(systemPingJob).register(
    defineJob({
      type: "design.import_figma",
      description: "Imports one Figma frame into a project as a design document. Output: { designId, report }.",
      input: z.object({
        projectId: z.string(),
        fileKey: z.string().min(1),
        nodeId: z.string().min(1),
        name: z.string().max(200).optional(),
      }),
      async handler(input, ctx) {
        const design = await importFigmaDesign(deps, deps.figma, input, (fraction, message) => ctx.progress(fraction, message));
        return { designId: design.id, name: design.name, width: design.width, height: design.height, report: design.importReport };
      },
    }),
  );
}
export * from "./planning.ts";
export * from "./images.ts";
export * from "./variations.ts";
