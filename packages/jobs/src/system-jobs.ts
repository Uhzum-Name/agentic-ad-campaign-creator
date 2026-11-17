import { z } from "zod";
import { defineJob } from "./index.ts";

/**
 * Diagnostic job: proves the queue → worker → result path works end to end.
 * It performs no creative work. Production job types are registered by the
 * engine packages as they are built.
 */
export const systemPingJob = defineJob({
  type: "system.ping",
  description: "Diagnostic: waits `steps` × `stepMs`, reporting progress, then echoes `message`.",
  input: z.object({
    message: z.string().default("pong"),
    steps: z.number().int().min(1).max(100).default(1),
    stepMs: z.number().int().min(0).max(10_000).default(0),
    failUntilAttempt: z.number().int().min(0).max(10).default(0).describe("Throw on attempts ≤ this value (tests retries)"),
  }),
  maxAttempts: 3,
  async handler(input, ctx) {
    if (ctx.attempt <= input.failUntilAttempt) throw new Error(`Deliberate failure on attempt ${ctx.attempt}`);
    for (let i = 1; i <= input.steps; i++) {
      if (input.stepMs) await new Promise((r) => setTimeout(r, input.stepMs));
      await ctx.progress(i / input.steps, `step ${i}/${input.steps}`);
    }
    return { message: input.message, attempt: ctx.attempt };
  },
});
