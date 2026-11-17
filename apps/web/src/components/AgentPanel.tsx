"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type Brief, type Message, api, timeAgo, useResource } from "../lib/api";
import { Button, ErrorNote, inputClass } from "./ui";

type Tab = "thread" | "brief";

export function AgentPanel({ campaignId, brief, onBriefSaved }: { campaignId: string; brief: Brief | null; onBriefSaved: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>("thread");
  return (
    <aside aria-label="Agent" className="flex w-[380px] shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div role="tablist" aria-label="Agent panel" className="flex shrink-0 border-b border-zinc-200 px-2">
        {(
          [
            ["thread", "Agent"],
            ["brief", brief ? `Brief · v${brief.version}` : "Brief"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? "border-accent text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "thread" ? <Thread campaignId={campaignId} /> : <BriefEditor campaignId={campaignId} brief={brief} onSaved={onBriefSaved} />}
    </aside>
  );
}

function Thread({ campaignId }: { campaignId: string }) {
  const messages = useResource<Message[]>(`/campaigns/${campaignId}/messages`, 2500);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  const count = messages.data?.length ?? 0;
  const agentHasPosted = messages.data?.some((m) => m.role === "agent") ?? false;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await api(`/campaigns/${campaignId}/messages`, { method: "POST", body: { text: value } });
      setText("");
      await messages.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.error && <ErrorNote>{messages.error.message}</ErrorNote>}
        {!agentHasPosted && !messages.loading && (
          <div className="mb-4 rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
            <p className="font-medium text-zinc-900">No agent has worked on this campaign yet</p>
            <p className="mt-1">
              Direction you leave here is saved. An agent connected to this workspace picks it up and reports its work back in this panel.
            </p>
          </div>
        )}
        <ol className="space-y-3">
          {messages.data?.map((m) => (
            <li key={m.id}>
              <MessageItem message={m} />
            </li>
          ))}
        </ol>
        <div ref={end} />
      </div>
      <form
        className="shrink-0 space-y-2 border-t border-zinc-200 p-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void send();
        }}
      >
        {error && <ErrorNote>{error}</ErrorNote>}
        <textarea
          aria-label="Direction for the agent"
          className={`${inputClass} resize-none`}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Leave direction for the agent…"
          maxLength={20000}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Enter to send · Shift+Enter for a new line</span>
          <Button type="submit" variant="primary" size="sm" disabled={!text.trim() || sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </>
  );
}

function MessageItem({ message }: { message: Message }) {
  if (message.kind === "activity") {
    return (
      <div className="flex gap-2 text-xs text-zinc-600">
        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-400" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message.text}</span>
        <time className="shrink-0 text-zinc-400" dateTime={message.createdAt}>
          {timeAgo(message.createdAt)}
        </time>
      </div>
    );
  }
  const mine = message.role === "user";
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <span className="mb-1 text-xs text-zinc-500">
        {mine ? "You" : "Agent"} · {timeAgo(message.createdAt)}
      </span>
      <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${mine ? "bg-accent text-white" : "bg-zinc-100 text-zinc-900"}`}>
        {message.text}
      </div>
      {mine && <span className="mt-1 text-xs text-zinc-500">{message.acknowledgedAt ? "Picked up by the agent" : "Waiting for an agent"}</span>}
    </div>
  );
}

function BriefEditor({ campaignId, brief, onSaved }: { campaignId: string; brief: Brief | null; onSaved: () => Promise<void> }) {
  const [text, setText] = useState(brief?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = text.trim() !== (brief?.text ?? "").trim();

  // Adopt a newer saved brief (e.g. saved elsewhere) unless there are unsaved edits here.
  const lastSeen = useRef(brief?.id);
  useEffect(() => {
    if (brief?.id !== lastSeen.current) {
      lastSeen.current = brief?.id;
      setText((current) => (current.trim() === "" || !dirty ? (brief?.text ?? "") : current));
    }
  }, [brief, dirty]);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await api(`/campaigns/${campaignId}/brief`, { method: "PUT", body: { text } });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <p className="text-sm text-zinc-600">Describe the campaign in your own words: what you are promoting, who it is for, and what you want people to do.</p>
      <textarea
        aria-label="Campaign brief"
        className={`${inputClass} min-h-0 flex-1 resize-none`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Launch our new trail running shoe to weekend hikers. Emphasise grip and comfort. Drive to the product page."
        maxLength={50000}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">{brief ? `Version ${brief.version} saved ${timeAgo(brief.createdAt)}` : "Not saved yet"}</span>
        <Button variant="primary" size="sm" disabled={!text.trim() || !dirty || saving} onClick={save}>
          {saving ? "Saving…" : brief ? "Save new version" : "Save brief"}
        </Button>
      </div>
    </div>
  );
}
