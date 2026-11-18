"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const TONES = {
  neutral: "bg-zinc-100 text-zinc-700",
  info: "bg-indigo-50 text-indigo-700",
  success: "bg-emerald-50 text-emerald-700",
  danger: "bg-rose-50 text-rose-700",
  warning: "bg-amber-50 text-amber-800",
} as const;
export type Tone = keyof typeof TONES;

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  planning: { label: "Planning", tone: "info" },
  in_production: { label: "In production", tone: "info" },
  in_review: { label: "In review", tone: "warning" },
  complete: { label: "Complete", tone: "success" },
  proposed: { label: "Proposed", tone: "warning" },
  generating: { label: "Generating", tone: "info" },
  ready: { label: "Ready for review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[s.tone]}`}>{s.label}</span>;
}

const BUTTONS = {
  primary: "bg-accent text-white hover:bg-accent-strong disabled:bg-zinc-300",
  secondary: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400",
  ghost: "text-zinc-600 hover:bg-zinc-100 disabled:text-zinc-300",
  danger: "text-rose-700 hover:bg-rose-50 disabled:text-zinc-300",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTONS; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm";
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed ${sizing} ${BUTTONS[variant]} ${className}`}
    />
  );
}

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-accent focus:outline-2 focus:outline-accent/30";

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {children}
    </p>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-zinc-600">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-zinc-200 ${className}`} />;
}

export interface Crumb {
  label: string;
  href?: string;
}

export function TopBar({ crumbs, children }: { crumbs: Crumb[]; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
        <Link href="/" className="font-semibold text-zinc-900">
          Creative Engine
        </Link>
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-zinc-300">/</span>
            {c.href ? (
              <Link href={c.href} className="truncate text-zinc-600 hover:text-zinc-900">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-medium text-zinc-900">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
