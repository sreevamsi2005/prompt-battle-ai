"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface LogEvent {
  id: string;
  ts: number;
  type: string;
  status: "ok" | "error";
  playerName?: string;
  roomId?: string;
  challengeId?: string;
  requestId?: string;
  durationMs?: number;
  detail?: Record<string, unknown>;
  error?: string;
}

const TYPE_LABEL: Record<string, string> = {
  text_score: "Text score",
  video_gen_queued: "Video queued",
  video_gen_completed: "Video generated",
  video_gen_failed: "Video failed",
  video_similarity: "Video similarity",
  submission_room: "Room submission",
  submission_global: "Global submission",
};

const TYPE_COLOR: Record<string, string> = {
  text_score: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  video_gen_queued: "text-zinc-300 border-zinc-600 bg-zinc-800/60",
  video_gen_completed: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  video_gen_failed: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  video_similarity: "text-violet-400 border-violet-500/30 bg-violet-500/10",
  submission_room: "text-[#0066FF] border-[#0066FF]/30 bg-[#0066FF]/10",
  submission_global: "text-amber-400 border-amber-500/30 bg-amber-500/10",
};

function fmtDuration(ms?: number): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtDetail(detail?: Record<string, unknown>): string {
  if (!detail) return "";
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 60 ? v.slice(0, 57) + "…" : v}`)
    .join("  ");
}

export default function AdminLogsPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const passwordRef = useRef("");

  const [events, setEvents] = useState<LogEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [playerFilter, setPlayerFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async (silent = false) => {
    if (!passwordRef.current) return;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "500" });
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (playerFilter.trim()) params.set("player", playerFilter.trim());
      const res = await fetch(`/api/admin/logs?${params}`, {
        headers: { "x-admin-password": passwordRef.current },
      });
      if (res.ok) {
        setEvents(await res.json());
        setAuthed(true);
        setAuthError(null);
      } else if (res.status === 401) {
        setAuthed(false);
        setAuthError("Wrong password.");
      }
    } catch {}
    if (!silent) setLoading(false);
  }, [typeFilter, statusFilter, playerFilter]);

  // Re-fetch when filters change (only once authed).
  useEffect(() => {
    if (authed) fetchLogs();
  }, [authed, fetchLogs]);

  // Auto-refresh every 5s.
  useEffect(() => {
    if (!authed || !autoRefresh) return;
    const t = setInterval(() => fetchLogs(true), 5000);
    return () => clearInterval(t);
  }, [authed, autoRefresh, fetchLogs]);

  const login = () => {
    passwordRef.current = password;
    fetchLogs();
  };

  const downloadCsv = async () => {
    const params = new URLSearchParams({ limit: "2000", format: "csv" });
    if (typeFilter) params.set("type", typeFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (playerFilter.trim()) params.set("player", playerFilter.trim());
    const res = await fetch(`/api/admin/logs?${params}`, {
      headers: { "x-admin-password": passwordRef.current },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `booth-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = async () => {
    if (!confirm("Clear ALL logs? This cannot be undone.")) return;
    await fetch("/api/admin/logs", {
      method: "DELETE",
      headers: { "x-admin-password": passwordRef.current },
    });
    fetchLogs();
  };

  if (!authed) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4">
        <div className="graphite-card p-6 w-full max-w-sm">
          <h1 className="text-lg font-bold text-white">Booth Logs</h1>
          <p className="mt-1 text-xs text-zinc-500">Enter the admin password to view request logs.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            placeholder="Admin password"
            className="input-field mt-4"
          />
          {authError && <p className="mt-2 text-xs text-rose-400 font-semibold">{authError}</p>}
          <button onClick={login} className="btn-primary w-full mt-4 py-2.5 text-sm font-bold">
            View Logs
          </button>
        </div>
      </div>
    );
  }

  const errorCount = events.filter((e) => e.status === "error").length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3.5 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight text-white uppercase">Booth Logs</h1>
          <span className="text-xs font-mono text-zinc-500">
            {events.length} events{errorCount > 0 && <span className="text-rose-400"> · {errorCount} errors</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono select-none cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            auto-refresh
          </label>
          <button onClick={() => fetchLogs()} className="btn-secondary px-3 py-1.5 text-xs font-semibold">
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button onClick={downloadCsv} className="btn-secondary px-3 py-1.5 text-xs font-semibold">
            Download CSV
          </button>
          <button onClick={clearLogs} className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition">
            Clear Logs
          </button>
          <Link href="/admin" className="btn-secondary px-3 py-1.5 text-xs font-semibold">
            ← Admin
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-field !w-auto text-xs py-1.5">
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field !w-auto text-xs py-1.5">
          <option value="">All statuses</option>
          <option value="ok">OK only</option>
          <option value="error">Errors only</option>
        </select>
        <input
          type="text"
          value={playerFilter}
          onChange={(e) => setPlayerFilter(e.target.value)}
          placeholder="Filter by player…"
          className="input-field !w-48 text-xs py-1.5"
        />
      </div>

      {/* Table */}
      <div className="graphite-card overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2.5 whitespace-nowrap">Time</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Event</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Player</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Duration</th>
              <th className="px-3 py-2.5">Details</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-zinc-600">No events logged yet.</td></tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className={`border-b border-zinc-900 align-top ${e.status === "error" ? "bg-rose-500/5" : ""}`}>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-400">
                  {new Date(e.ts).toLocaleTimeString()}
                  <span className="block text-[10px] text-zinc-600">{new Date(e.ts).toLocaleDateString()}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold ${TYPE_COLOR[e.type] ?? "text-zinc-300 border-zinc-700 bg-zinc-800/60"}`}>
                    {TYPE_LABEL[e.type] ?? e.type}
                  </span>
                  {e.status === "error" && (
                    <span className="ml-1.5 inline-block rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">ERR</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-white font-semibold">{e.playerName ?? <span className="text-zinc-600">—</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-300">{fmtDuration(e.durationMs)}</td>
                <td className="px-3 py-2 text-zinc-400 break-all">
                  {fmtDetail(e.detail)}
                  {e.challengeId && <span className="text-zinc-600">  challenge={e.challengeId}</span>}
                  {e.requestId && <span className="text-zinc-600">  req={e.requestId.slice(0, 12)}…</span>}
                  {e.error && <span className="block text-rose-400 mt-0.5">{e.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-zinc-600 font-mono">
        Newest first · keeps the last 2000 events · auto-refreshes every 5s while enabled.
      </p>
    </div>
  );
}
