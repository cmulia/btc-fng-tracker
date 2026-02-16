"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type EntryKind = "transfer" | "liquidity" | "staking" | "swap" | "bridge" | "other";
type EntryIntensity = "low" | "medium" | "high";

type JournalEntry = {
  id: string;
  createdAt: string;
  date: string;
  kind: EntryKind;
  chain: string;
  protocol: string;
  title: string;
  notes: string;
  amount: string;
  token: string;
  intensity: EntryIntensity;
};

type NewEntryState = {
  date: string;
  kind: EntryKind;
  chain: string;
  protocol: string;
  title: string;
  notes: string;
  amount: string;
  token: string;
  intensity: EntryIntensity;
};

const THEME_STORAGE_KEY = "momentum_theme_v1";

const KIND_LABELS: Record<EntryKind, string> = {
  transfer: "Transfer",
  liquidity: "Liquidity",
  staking: "Staking",
  swap: "Swap",
  bridge: "Bridge",
  other: "Other",
};

const INTENSITY_LABELS: Record<EntryIntensity, string> = {
  low: "Routine",
  medium: "Conviction",
  high: "High Risk",
};

function getTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultEntry(): NewEntryState {
  return {
    date: getTodayIso(),
    kind: "transfer",
    chain: "Base",
    protocol: "Aave",
    title: "",
    notes: "",
    amount: "",
    token: "USDC",
    intensity: "medium",
  };
}

function loadThemePreference() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(THEME_STORAGE_KEY) !== "light";
}

export default function JournalPage() {
  const [entry, setEntry] = useState<NewEntryState>(defaultEntry);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [filter, setFilter] = useState<"today" | "all">("today");
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => loadThemePreference());
  const [formError, setFormError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncLoading, setIsSyncLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  useEffect(() => {
    let cancelled = false;
    const loadEntries = async () => {
      setIsSyncLoading(true);
      try {
        const res = await fetch("/api/journal", { cache: "no-store" });
        const payload = (await res.json()) as { entries?: JournalEntry[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setSyncError(payload?.error ?? "Could not load synced journal entries.");
          setEntries([]);
          return;
        }
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
        setSyncError(null);
      } catch {
        if (!cancelled) {
          setSyncError("Network error while loading journal entries.");
          setEntries([]);
        }
      } finally {
        if (!cancelled) setIsSyncLoading(false);
      }
    };

    loadEntries();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleEntries = useMemo(() => {
    const sorted = [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (filter === "all") return sorted;
    return sorted.filter((item) => item.date === getTodayIso());
  }, [entries, filter]);

  const stats = useMemo(() => {
    const total = entries.length;
    const today = entries.filter((item) => item.date === getTodayIso()).length;
    const highRisk = entries.filter((item) => item.intensity === "high").length;
    return { total, today, highRisk };
  }, [entries]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const title = entry.title.trim();
    const notes = entry.notes.trim();
    if (!title || !notes) {
      setFormError("Please add both a headline and notes before saving.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: entry.date,
          kind: entry.kind,
          chain: entry.chain.trim(),
          protocol: entry.protocol.trim(),
          title,
          notes,
          amount: entry.amount.trim(),
          token: entry.token.trim(),
          intensity: entry.intensity,
        }),
      });
      const payload = (await res.json()) as { entry?: JournalEntry; error?: string };
      if (!res.ok || !payload.entry) {
        throw new Error(payload?.error ?? "Could not save journal entry.");
      }
      setEntries((prev) => [payload.entry as JournalEntry, ...prev]);
      setEntry((prev) => ({ ...defaultEntry(), date: prev.date }));
      setFormError(null);
      setSyncError(null);
      setFilter("all");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save journal entry.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeEntry = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/journal?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload?.error ?? "Could not delete entry.");
      }
      setEntries((prev) => prev.filter((item) => item.id !== id));
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Could not delete entry.");
    } finally {
      setDeletingId(null);
    }
  };

  const themeToggle = (
    <button
      type="button"
      onClick={() => setIsDarkMode((prev) => !prev)}
      className={`fixed right-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur transition sm:right-6 sm:top-6 ${
        isDarkMode
          ? "border-amber-400/45 bg-amber-300/15 text-amber-100 hover:bg-amber-300/25"
          : "border-amber-300/85 bg-white/90 text-amber-700 hover:bg-amber-50"
      }`}
      aria-label="Toggle light and dark mode"
      title="Toggle light and dark mode"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.2v2.4M12 19.4v2.4M21.8 12h-2.4M4.6 12H2.2M18.95 5.05l-1.7 1.7M6.75 17.25l-1.7 1.7M18.95 18.95l-1.7-1.7M6.75 6.75l-1.7-1.7" />
      </svg>
    </button>
  );

  return (
    <main
      className={`min-h-screen px-4 py-6 text-zinc-950 transition-all duration-700 sm:px-6 lg:px-8 ${
        isDarkMode
          ? "bg-[radial-gradient(circle_at_18%_12%,rgba(180,83,9,0.9),rgba(41,22,8,0.96)_42%,rgba(18,11,2,1)_100%)] text-amber-100"
          : "bg-[radial-gradient(circle_at_15%_10%,rgba(196,242,165,0.55),rgba(244,252,210,0.65)_38%,rgba(241,247,223,0.85)_70%,rgba(234,242,210,0.95)_100%)] text-zinc-950"
      }`}
    >
      {themeToggle}
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <nav className="ui-card p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                isDarkMode
                  ? "border-amber-400/40 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20"
                  : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
              }`}
            >
              Home
            </Link>
            <Link
              href="/#overview"
              className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                isDarkMode
                  ? "border-amber-400/40 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20"
                  : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/journal"
              className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                isDarkMode
                  ? "border-amber-300/70 bg-amber-400 text-zinc-950 hover:bg-amber-300"
                  : "border-amber-300/80 bg-amber-400 text-zinc-950 hover:bg-amber-300"
              }`}
            >
              Journal
            </Link>
          </div>
        </nav>

        <header className="ui-card p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Momentum</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-amber-100 sm:text-4xl">Crypto Journal</h1>
            <p className="mt-2 max-w-2xl text-sm ui-soft">
              Write exactly what you did today: bridges, transfers, LP actions, stakes, and why you made each move.
            </p>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="ui-card p-4">
            <p className="text-xs uppercase tracking-wide text-amber-300/90">Entries Today</p>
            <p className="mt-2 text-3xl font-black text-amber-100">{stats.today}</p>
          </article>
          <article className="ui-card p-4">
            <p className="text-xs uppercase tracking-wide text-amber-300/90">Total Logged</p>
            <p className="mt-2 text-3xl font-black text-amber-100">{stats.total}</p>
          </article>
          <article className="ui-card p-4">
            <p className="text-xs uppercase tracking-wide text-rose-300/90">High Risk Moves</p>
            <p className="mt-2 text-3xl font-black text-rose-100">{stats.highRisk}</p>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <article className="ui-card p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">New Entry</p>
              <h2 className="mt-1 text-xl font-bold text-amber-100">Log Today&apos;s Actions</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-amber-200/90">Date</span>
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(event) => setEntry((prev) => ({ ...prev, date: event.target.value }))}
                    className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-amber-200/90">Action Type</span>
                  <select
                    value={entry.kind}
                    onChange={(event) => setEntry((prev) => ({ ...prev, kind: event.target.value as EntryKind }))}
                    className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                  >
                    {Object.entries(KIND_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs text-amber-200/90">Headline</span>
                <input
                  required
                  value={entry.title}
                  onChange={(event) => setEntry((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Moved USDC from MetaMask to Base for LP setup"
                  className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-amber-200/90">Chain / Network</span>
                  <input
                    value={entry.chain}
                    onChange={(event) => setEntry((prev) => ({ ...prev, chain: event.target.value }))}
                    placeholder="Base"
                    className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-amber-200/90">Protocol</span>
                  <input
                    value={entry.protocol}
                    onChange={(event) => setEntry((prev) => ({ ...prev, protocol: event.target.value }))}
                    placeholder="Aave / Uniswap / Aerodrome"
                    className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-xs text-amber-200/90">Amount</span>
                  <input
                    value={entry.amount}
                    onChange={(event) => setEntry((prev) => ({ ...prev, amount: event.target.value }))}
                    placeholder="500"
                    className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-amber-200/90">Token</span>
                  <input
                    value={entry.token}
                    onChange={(event) => setEntry((prev) => ({ ...prev, token: event.target.value }))}
                    placeholder="USDC"
                    className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm uppercase outline-none ring-amber-400/60 transition focus:ring-2"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-amber-200/90">Risk / Size</span>
                  <select
                    value={entry.intensity}
                    onChange={(event) => setEntry((prev) => ({ ...prev, intensity: event.target.value as EntryIntensity }))}
                    className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                  >
                    {Object.entries(INTENSITY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs text-amber-200/90">Notes (what happened + why)</span>
                <textarea
                  required
                  value={entry.notes}
                  onChange={(event) => setEntry((prev) => ({ ...prev, notes: event.target.value }))}
                  rows={4}
                  placeholder="Bridged USDC to Base, supplied to Aave v3, and kept 30% liquid for pullback entries."
                  className="w-full rounded-lg border border-amber-500/35 bg-black/30 px-3 py-2 text-sm outline-none ring-amber-400/60 transition focus:ring-2"
                />
              </label>
              {formError && <p className="text-xs text-rose-300">{formError}</p>}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-xl border border-amber-300/40 bg-[linear-gradient(115deg,rgba(245,158,11,0.36),rgba(180,83,9,0.42))] px-4 py-2 text-sm font-semibold text-amber-50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Crypto Journal Entry"}
              </button>
            </form>
          </article>

          <article className="ui-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Timeline</p>
                <h2 className="mt-1 text-xl font-bold text-amber-100">Action Log</h2>
              </div>
              <div className="inline-flex rounded-lg border border-amber-500/30 bg-black/25 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setFilter("today")}
                  className={`rounded-md px-2 py-1 transition ${filter === "today" ? "bg-amber-500 text-zinc-950" : "text-amber-200 hover:bg-amber-900/25"}`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={`rounded-md px-2 py-1 transition ${filter === "all" ? "bg-amber-500 text-zinc-950" : "text-amber-200 hover:bg-amber-900/25"}`}
                >
                  All
                </button>
              </div>
            </div>

            <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {isSyncLoading ? (
                <div className="rounded-xl border border-dashed border-amber-500/35 bg-black/20 p-4 text-sm text-amber-100/80">
                  Loading synced entries...
                </div>
              ) : syncError ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-900/20 p-4 text-sm text-rose-100">
                  {syncError}
                </div>
              ) : visibleEntries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-amber-500/35 bg-black/20 p-4 text-sm text-amber-100/80">
                  No entries yet. Add your first move and build your personal trading diary.
                </div>
              ) : (
                visibleEntries.map((item) => (
                  <article key={item.id} className="rounded-xl border border-amber-500/25 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-amber-300">
                          {item.date} • {KIND_LABELS[item.kind]}
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-amber-50">{item.title}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeEntry(item.id)}
                        disabled={deletingId === item.id}
                        className="rounded-md border border-rose-400/40 px-2 py-1 text-[11px] text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingId === item.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>

                    <p className="mt-2 text-sm leading-relaxed text-amber-100/90">{item.notes}</p>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-amber-500/25 bg-amber-950/25 px-2 py-1 text-amber-100">
                        {item.chain || "No chain"}
                      </span>
                      <span className="rounded-full border border-amber-500/25 bg-amber-950/25 px-2 py-1 text-amber-100">
                        {item.protocol || "No protocol"}
                      </span>
                      {(item.amount || item.token) && (
                        <span className="rounded-full border border-emerald-500/35 bg-emerald-900/30 px-2 py-1 text-emerald-100">
                          {`${item.amount || "?"} ${item.token || ""}`.trim()}
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-1 ${
                          item.intensity === "high"
                            ? "border-rose-500/35 bg-rose-900/30 text-rose-100"
                            : item.intensity === "medium"
                              ? "border-amber-500/35 bg-amber-900/30 text-amber-100"
                              : "border-amber-500/35 bg-amber-900/20 text-amber-50"
                        }`}
                      >
                        {INTENSITY_LABELS[item.intensity]}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
