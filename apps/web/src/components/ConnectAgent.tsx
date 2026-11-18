"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

/** How to connect Claude to this workspace, with the MCP address to copy. */
export function ConnectAgent({ campaignId }: { campaignId: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/api/mcp`;
  const prompt = `Work on campaign ${campaignId} in the creative engine: read the brief, ask me anything that's missing, then propose a creative plan.`;

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(undefined), 1500);
    } catch {
      setCopied(undefined);
    }
  }

  return (
    <details className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
      <summary className="cursor-pointer text-sm font-medium text-zinc-900">Connect Claude</summary>
      <ol className="mt-2 list-decimal space-y-2 pl-4">
        <li>
          Add this address to Claude as a custom connector (MCP server):
          <div className="mt-1 flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate rounded bg-zinc-100 px-1.5 py-1 font-mono text-[11px]">{url}</code>
            <Button size="sm" onClick={() => copy("url", url)}>
              {copied === "url" ? "Copied" : "Copy"}
            </Button>
          </div>
        </li>
        <li>
          Then ask Claude, for example:
          <div className="mt-1 flex items-start gap-1">
            <p className="min-w-0 flex-1 rounded bg-zinc-100 px-1.5 py-1 text-[11px]">{prompt}</p>
            <Button size="sm" onClick={() => copy("prompt", prompt)}>
              {copied === "prompt" ? "Copied" : "Copy"}
            </Button>
          </div>
        </li>
      </ol>
    </details>
  );
}
