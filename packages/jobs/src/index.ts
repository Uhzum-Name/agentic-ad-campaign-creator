import { AppError, type JobStatus, TERMINAL_JOB_STATUSES, toErrorBody } from "@adengine/core";
import { type Db, jobs } from "@adengine/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import type { z } from "zod";

/*
 * Asynchronous execution.
 *
 *   submit()  → inserts a row in `jobs` (status queued) and enqueues a pg-boss
 *               message carrying only the job id.
 *   worker    → picks the message up, runs the registered handler, and writes
 *               status / progress / output / error back to the `jobs` row.
 *
 * The `jobs` table is the only thing clients read, so a job is observable and
 * outlives whichever browser tab or agent session submitted it.
 */

export type JobRow = typeof jobs.$inferSelect;

export interface JobContext {
  jobId: string;
  projectId: string | null;
  attempt: number;
  db: Db;
  /** `fraction` is 0..1. Throws `job_cancelled` if cancellation was requested. */
  progress(fraction: number, message?: string): Promise<void>;
  /** Throws `job_cancelled` if cancellation was requested. Call between units of work. */
  throwIfCancelled(): Promise<void>;
}

export interface JobDefinition<I = unknown, O = unknown> {
  type: string;
  description: string;
  input: z.ZodType<I>;
  /** Total attempts including the first. Defaults to 1 (no retry). */
  maxAttempts?: number;
  handler(input: I, ctx: JobContext): Promise<O>;
}

export function defineJob<I, O>(def: JobDefinition<I, O>): JobDefinition<I, O> {
  return def;
}

export class JobRegistry {
  private readonly defs = new Map<string, JobDefinition<any, any>>();

  register(def: JobDefinition<any, any>): this {
    if (this.defs.has(def.type)) throw new Error(`Job type ${def.type} is already registered`);
    this.defs.set(def.type, def);
    return this;
  }
  get(type: string): JobDefinition | undefined {
    return this.defs.get(type);
  }
  list(): JobDefinition[] {
    return [...this.defs.values()];
  }
}

const queueName = (type: string) => `job.${type}`;

export interface JobSystemOptions {
  db: Db;
  databaseUrl: string;
  registry: JobRegistry;
  /** Postgres schema for the queue's own tables. Tests use a separate one. */
  queueSchema?: string;
  pollingIntervalSeconds?: number;
  /**
   * "queue" (default): jobs are dispatched to a worker process through pg-boss.
   * "inline": no queue and no worker; `submit` runs the job to completion in
   * the calling process before returning. For hosts that cannot run a worker.
   * Only suitable for jobs that finish within the host's request time limit.
   */
  mode?: "queue" | "inline";
}

export class JobSystem {
  private readonly boss: PgBoss;
  private readonly inline: boolean;
  private readonly db: Db;
  private readonly registry: JobRegistry;
  private readonly pollingIntervalSeconds: number;
  private started = false;

  constructor(opts: JobSystemOptions) {
    this.db = opts.db;
    this.registry = opts.registry;
    this.pollingIntervalSeconds = opts.pollingIntervalSeconds ?? 1;
    this.inline = opts.mode === "inline";
    // Constructing the client opens no connection; that happens in start().
    this.boss = new PgBoss({ connectionString: opts.databaseUrl, schema: opts.queueSchema ?? "pgboss" });
    this.boss.on("error", (err) => console.error("[jobs] queue error:", err));
  }

  async start(): Promise<void> {
    if (this.started || this.inline) return;
    await this.boss.start();
    for (const def of this.registry.list()) await this.boss.createQueue(queueName(def.type));
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, timeout: 10_000 });
    this.started = false;
  }

  /** Validates input, records the job and enqueues it. Returns immediately. */
  async submit(type: string, input: unknown, opts: { projectId?: string; parentJobId?: string } = {}): Promise<JobRow> {
    const def = this.registry.get(type);
    if (!def) {
      throw new AppError("validation_error", `Unknown job type "${type}"`, {
        knownTypes: this.registry.list().map((d) => d.type),
      });
    }
    const parsed = def.input.safeParse(input ?? {});
    if (!parsed.success) {
      throw new AppError("validation_error", `Invalid input for job type "${type}"`, parsed.error.issues);
    }
    const maxAttempts = def.maxAttempts ?? 1;
    await this.start(); // lazy, so hosts that only serve requests connect to the queue on first use
    const [row] = await this.db
      .insert(jobs)
      .values({ type, input: parsed.data, maxAttempts, projectId: opts.projectId, parentJobId: opts.parentJobId })
      .returning();
    if (!row) throw new Error("Failed to insert job");
    if (this.inline) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await this.run(def, row.id);
          break;
        } catch {
          // run() recorded the error and left the job queued for another attempt.
        }
      }
      return this.get(row.id);
    }
    try {
      const queueJobId = await this.boss.send(
        queueName(type),
        { jobId: row.id },
        { retryLimit: maxAttempts - 1, retryDelay: 2, retryBackoff: true },
      );
      const [updated] = await this.db.update(jobs).set({ queueJobId }).where(eq(jobs.id, row.id)).returning();
      return updated ?? row;
    } catch (err) {
      await this.finish(row.id, "failed", { error: toErrorBody(err) });
      throw err;
    }
  }

  async get(id: string): Promise<JobRow> {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, id));
    if (!row) throw AppError.notFound("Job", id);
    return row;
  }

  /**
   * Queued jobs are cancelled immediately. Running jobs are flagged and stop at
   * their next `progress()` / `throwIfCancelled()` call. Finished jobs are unchanged.
   */
  async cancel(id: string): Promise<JobRow> {
    const row = await this.get(id);
    if (TERMINAL_JOB_STATUSES.includes(row.status)) return row;
    await this.start();
    const now = new Date();
    const [cancelledWhileQueued] = await this.db
      .update(jobs)
      .set({ status: "cancelled", cancelRequestedAt: now, finishedAt: now })
      .where(and(eq(jobs.id, id), eq(jobs.status, "queued")))
      .returning();
    if (cancelledWhileQueued) {
      if (row.queueJobId && !this.inline) await this.boss.cancel(queueName(row.type), row.queueJobId).catch(() => {});
      return cancelledWhileQueued;
    }
    await this.db.update(jobs).set({ cancelRequestedAt: now }).where(and(eq(jobs.id, id), eq(jobs.status, "running")));
    return this.get(id);
  }

  /** Starts consuming every registered job type. Call from the worker process. */
  async work(opts: { concurrency?: number } = {}): Promise<void> {
    if (this.inline) throw new Error("An inline job system has no queue to work");
    await this.start();
    for (const def of this.registry.list()) {
      await this.boss.work<{ jobId: string }>(
        queueName(def.type),
        { localConcurrency: opts.concurrency ?? 2, pollingIntervalSeconds: this.pollingIntervalSeconds },
        async ([message]) => {
          if (message) await this.run(def, message.data.jobId);
        },
      );
    }
  }

  private async run(def: JobDefinition, jobId: string): Promise<void> {
    // Claim: only a queued or (after a worker crash) still-"running" job may start.
    const [row] = await this.db
      .update(jobs)
      .set({ status: "running", startedAt: new Date(), attempts: sql`${jobs.attempts} + 1`, error: null })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])))
      .returning();
    if (!row) return; // cancelled or already finished

    const throwIfCancelled = async () => {
      const [current] = await this.db.select({ c: jobs.cancelRequestedAt }).from(jobs).where(eq(jobs.id, jobId));
      if (current?.c) throw new AppError("job_cancelled", "The job was cancelled");
    };
    const ctx: JobContext = {
      jobId,
      projectId: row.projectId,
      attempt: row.attempts,
      db: this.db,
      throwIfCancelled,
      progress: async (fraction, message) => {
        await throwIfCancelled();
        await this.db
          .update(jobs)
          .set({ progress: Math.max(0, Math.min(1, fraction)), ...(message !== undefined ? { progressMessage: message } : {}) })
          .where(eq(jobs.id, jobId));
      },
    };

    try {
      await throwIfCancelled();
      const output = await def.handler(def.input.parse(row.input), ctx);
      await this.finish(jobId, "succeeded", { output: output ?? null, progress: 1 });
    } catch (err) {
      if (err instanceof AppError && err.code === "job_cancelled") {
        await this.finish(jobId, "cancelled", {});
        return;
      }
      const error = toErrorBody(err);
      if (row.attempts < row.maxAttempts) {
        // Leave it queued and rethrow so the queue redelivers after its backoff.
        await this.db.update(jobs).set({ status: "queued", error }).where(eq(jobs.id, jobId));
        throw err;
      }
      await this.finish(jobId, "failed", { error });
    }
  }

  private async finish(
    id: string,
    status: JobStatus,
    fields: { output?: unknown; error?: ReturnType<typeof toErrorBody>; progress?: number },
  ): Promise<void> {
    await this.db.update(jobs).set({ status, finishedAt: new Date(), ...fields }).where(eq(jobs.id, id));
  }
}

export { systemPingJob } from "./system-jobs.ts";

