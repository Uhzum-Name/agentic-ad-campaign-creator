"use client";

import { type FormEvent, useState } from "react";
import { Button, ErrorNote, inputClass } from "./ui";

/** A one-field inline form used to create projects, campaigns and directions. */
export function CreateForm({
  label,
  placeholder,
  submitLabel,
  onCreate,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onCreate(name.trim());
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input aria-label={label} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={200} />
        <Button type="submit" variant="primary" disabled={!name.trim() || busy} className="shrink-0">
          {busy ? "Creating…" : submitLabel}
        </Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </form>
  );
}
