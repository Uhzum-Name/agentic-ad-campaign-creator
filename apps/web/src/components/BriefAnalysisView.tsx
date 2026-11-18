"use client";

import type { Brief } from "../lib/api";
import { timeAgo } from "../lib/api";

/** The agent's structured reading of the current brief. */
export function BriefAnalysisView({ brief }: { brief: Brief }) {
  const a = brief.analysis;
  if (!a) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-600">
        <h3 className="text-sm font-semibold text-zinc-900">Agent's reading</h3>
        <p className="mt-1">Not analysed yet. A connected agent records its reading of the brief here before planning.</p>
      </section>
    );
  }
  const fields: [string, string | undefined][] = [
    ["Objective", a.objective],
    ["Audience", a.audience],
    ["Product", a.product],
    ["Call to action", a.callToAction],
    ["Offer", a.offer],
    ["Tone", a.tone],
  ];
  const lists: [string, string[]][] = [
    ["Key messages", a.keyMessages],
    ["Must include", a.mandatories],
    ["Avoid / constraints", a.constraints],
    ["Formats asked for", a.requestedFormats],
  ];
  return (
    <section aria-label="Agent's reading of the brief" className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-700">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">Agent's reading</h3>
        <p className="text-zinc-500">
          Of brief v{brief.version}
          {brief.analyzedAt ? `, ${timeAgo(brief.analyzedAt)}` : ""}
        </p>
      </div>
      <p className="text-sm text-zinc-900">{a.summary}</p>
      <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1">
        {fields
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="text-zinc-900">{v}</dd>
            </div>
          ))}
      </dl>
      {lists
        .filter(([, v]) => v.length)
        .map(([k, v]) => (
          <div key={k}>
            <p className="text-zinc-500">{k}</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-zinc-900">
              {v.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      {a.missingInformation.length > 0 && (
        <div className="rounded-md bg-amber-50 px-2 py-2">
          <p className="font-medium text-amber-900">Not in the brief</p>
          <ul className="mt-1 space-y-1">
            {a.missingInformation.map((m) => (
              <li key={m.topic}>
                <span className="font-medium text-zinc-900">{m.topic}</span> — {m.why}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
