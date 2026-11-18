"use client";

import { forwardRef, useState } from "react";
import { type Plan, type Workspace, api, timeAgo } from "../lib/api";
import { Button, ErrorNote, inputClass } from "./ui";

const STATUS: Record<Plan["status"], { label: string; tone: string }> = {
  proposed: { label: "Awaiting your approval", tone: "bg-amber-50 text-amber-800" },
  changes_requested: { label: "Changes requested", tone: "bg-zinc-100 text-zinc-700" },
  approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-700" },
  superseded: { label: "Replaced", tone: "bg-zinc-100 text-zinc-600" },
};

const ELEMENT_LABELS: Record<string, string> = {
  headline: "Headline",
  subheadline: "Subheadline",
  body: "Body copy",
  image: "Image",
  offer: "Offer",
  cta: "CTA",
  layout: "Layout",
  messaging: "Messaging",
  visual_treatment: "Visual treatment",
  animation: "Animation",
};

/** The campaign's latest creative plan, with approval controls while it is proposed. */
export const PlanPanel = forwardRef<HTMLElement, { plan: Plan; workspace: Workspace; onChange: () => Promise<void>; expanded: boolean; onToggle: () => void }>(
  function PlanPanel({ plan, workspace, onChange, expanded, onToggle }, ref) {
    const [mode, setMode] = useState<"idle" | "changes">("idle");
    const [feedback, setFeedback] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const p = plan.plan;
    const e = plan.estimate;
    const status = STATUS[plan.status];
    const proposed = plan.status === "proposed";
    const stale = plan.briefVersion !== null && workspace.brief !== null && workspace.brief.version > plan.briefVersion;
    const designName = (id?: string) => (id ? (workspace.designs[id]?.name ?? "A project design") : undefined);

    async function act(path: string, body: object) {
      setBusy(true);
      setError(undefined);
      try {
        await api(path, { method: "POST", body });
        setMode("idle");
        setFeedback("");
        await onChange();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }

    return (
      <section ref={ref} aria-label={`Creative plan version ${plan.version}`} className={`rounded-xl border bg-white ${proposed ? "border-amber-300 shadow-sm" : "border-zinc-200"}`}>
        <header className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Creative plan · v{plan.version}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
              <span className="text-xs text-zinc-500">Proposed {timeAgo(plan.createdAt)}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              {e.directions} direction{e.directions === 1 ? "" : "s"} · {e.variations} variations · {e.sizes} size{e.sizes === 1 ? "" : "s"} · {e.creatives} creatives · {e.files} files (
              {p.outputs.map((o) => o.toUpperCase()).join(", ")}) · about {e.renderMinutes} min to render
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? "Hide details" : "Show details"}
          </Button>
        </header>

        {stale && proposed && (
          <p className="mx-4 mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This plan was written for brief v{plan.briefVersion}; the brief is now v{workspace.brief!.version}.
          </p>
        )}

        {expanded && (
          <div className="space-y-4 border-t border-zinc-100 px-4 py-4 text-sm">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[120px_1fr]">
              <dt className="text-zinc-500">Objective</dt>
              <dd>{p.objective}</dd>
              <dt className="text-zinc-500">Audience</dt>
              <dd>{p.audience}</dd>
              <dt className="text-zinc-500">Messaging</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-4">
                  {p.messaging.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </dd>
              {p.tone && (
                <>
                  <dt className="text-zinc-500">Tone</dt>
                  <dd>{p.tone}</dd>
                </>
              )}
              {p.animation && (
                <>
                  <dt className="text-zinc-500">Animation</dt>
                  <dd>{p.animation}</dd>
                </>
              )}
            </dl>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Directions</h3>
              <ul className="grid gap-3 lg:grid-cols-2">
                {p.directions.map((d) => (
                  <li key={d.name} className="rounded-lg border border-zinc-200 px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{d.name}</p>
                      <span className="shrink-0 text-xs text-zinc-600">{d.variationCount} variations</span>
                    </div>
                    <p className="mt-1 text-zinc-700">{d.concept}</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      <span className="text-zinc-500">Leads with:</span> {d.messagingAngle}
                    </p>
                    {d.visualTreatment && (
                      <p className="mt-1 text-xs text-zinc-600">
                        <span className="text-zinc-500">Look:</span> {d.visualTreatment}
                      </p>
                    )}
                    {d.sourceDesignId && (
                      <p className="mt-1 text-xs text-zinc-600">
                        <span className="text-zinc-500">Built from:</span> {designName(d.sourceDesignId)}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {d.varyElements.map((v) => (
                        <span key={v} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700">
                          Varies {ELEMENT_LABELS[v] ?? v}
                        </span>
                      ))}
                    </div>
                    {d.sampleHeadlines.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs italic text-zinc-700">
                        {d.sampleHeadlines.map((h) => (
                          <li key={h}>“{h}”</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sizes</h3>
                <p className="text-zinc-700">{p.formats.map((f) => `${f.width}×${f.height}${f.label ? ` (${f.label})` : ""}`).join(", ")}</p>
                <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Workflow</h3>
                <ol className="list-decimal space-y-0.5 pl-4 text-zinc-700">
                  {p.workflow.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ol>
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Estimate</h3>
                <p className="text-zinc-700">
                  {e.variations} variations × {e.sizes} sizes = {e.creatives} creatives; × {p.outputs.length} output format{p.outputs.length === 1 ? "" : "s"} = {e.files} files. About {e.renderMinutes} minutes of rendering.
                </p>
                <ul className="mt-1 list-disc pl-4 text-xs text-zinc-500">
                  {e.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                {p.assumptions.length > 0 && (
                  <>
                    <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Assumptions</h3>
                    <ul className="list-disc space-y-0.5 pl-4 text-zinc-700">
                      {p.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
            {p.rationale && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Why this plan</h3>
                <p className="text-zinc-700">{p.rationale}</p>
              </div>
            )}
          </div>
        )}

        {plan.status === "changes_requested" && plan.feedback && (
          <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-600">
            You asked for: “{plan.feedback}”. The agent's revised plan will appear here.
          </p>
        )}
        {plan.status === "approved" && (
          <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-600">
            Approved {plan.decidedAt ? timeAgo(plan.decidedAt) : ""}
            {plan.decidedBy === "agent" ? ` by the agent on your instruction (“${plan.decisionNote}”)` : ""}. Its directions are below.
          </p>
        )}

        {proposed && (
          <footer className="space-y-2 border-t border-zinc-100 px-4 py-3">
            {mode === "changes" ? (
              <form
                className="space-y-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void act(`/plans/${plan.id}/request-changes`, { feedback });
                }}
              >
                <textarea
                  aria-label="What should change"
                  className={`${inputClass} resize-y`}
                  rows={3}
                  value={feedback}
                  onChange={(ev) => setFeedback(ev.target.value)}
                  placeholder="What should change? e.g. Replace the second direction with one about career growth."
                  maxLength={5000}
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" disabled={!feedback.trim() || busy}>
                    {busy ? "Sending…" : "Send to agent"}
                  </Button>
                  <Button variant="ghost" onClick={() => setMode("idle")}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={busy} onClick={() => act(`/plans/${plan.id}/approve`, {})}>
                  {busy ? "Approving…" : "Approve plan"}
                </Button>
                <Button disabled={busy} onClick={() => setMode("changes")}>
                  Request changes
                </Button>
                <span className="text-xs text-zinc-500">Approving creates the {e.directions} directions below. Variations are produced in the next step.</span>
              </div>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
          </footer>
        )}
      </section>
    );
  },
);
