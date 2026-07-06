import { blobGet, blobUpdate } from "./blob-storage";

/* ── Structured event log ─────────────────────────────────────────────────
 * Every meaningful request in the game writes one entry here: text scoring,
 * video generation (queued → completed/failed, with duration), video
 * similarity analysis, and leaderboard submissions — plus every error.
 * Persisted in Netlify Blobs (data/logs-events.json in local dev) and
 * browsable at /admin/logs or via GET /api/admin/logs (JSON or CSV).
 */

export type LogEventType =
  | "text_score"            // prompt similarity scored (OpenAI/Gemini/mock)
  | "video_gen_queued"      // fal.ai job submitted
  | "video_gen_completed"   // fal.ai job finished (durationMs = queue→complete)
  | "video_gen_failed"      // fal.ai job failed / result fetch failed
  | "video_similarity"      // video vs reference similarity computed
  | "submission_room"       // player submission recorded for the room round
  | "submission_global";    // score published to the global leaderboard

export interface LogEvent {
  id: string;
  ts: number;                 // epoch ms
  type: LogEventType;
  status: "ok" | "error";
  playerName?: string;
  roomId?: string;
  challengeId?: string;
  requestId?: string;         // fal.ai request id (links queued → completed)
  durationMs?: number;        // how long the operation took
  detail?: Record<string, unknown>; // scores, method, promptChars, videoUrl, …
  error?: string;             // present when status === "error"
}

const STORE = "logs";
const KEY = "events";
// Keep the most recent N events; older ones are trimmed on write so the blob
// never grows unbounded across a long booth day.
const MAX_EVENTS = 2000;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Append one event. NEVER throws — logging must not break the game. */
export async function logEvent(event: Omit<LogEvent, "id" | "ts"> & { ts?: number }): Promise<void> {
  try {
    const entry: LogEvent = { id: makeId(), ts: event.ts ?? Date.now(), ...event };
    await blobUpdate<LogEvent[]>(STORE, KEY, [], (current) => {
      current.push(entry);
      return current.length > MAX_EVENTS ? current.slice(-MAX_EVENTS) : current;
    });
  } catch (err) {
    console.error("[event-log] append failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Record a terminal video-generation event (completed/failed) exactly once per
 * requestId, computing durationMs from the matching "video_gen_queued" event.
 * Safe against the client polling the same terminal status multiple times.
 * NEVER throws.
 */
export async function logVideoGenTerminal(
  requestId: string,
  outcome: "completed" | "failed",
  detail?: Record<string, unknown>,
  error?: string
): Promise<void> {
  try {
    await blobUpdate<LogEvent[]>(STORE, KEY, [], (current) => {
      // Already recorded a terminal event for this job → no duplicate.
      const done = current.some(
        (e) => e.requestId === requestId && (e.type === "video_gen_completed" || e.type === "video_gen_failed")
      );
      if (done) return current;

      const queued = current.find((e) => e.requestId === requestId && e.type === "video_gen_queued");
      const entry: LogEvent = {
        id: makeId(),
        ts: Date.now(),
        type: outcome === "completed" ? "video_gen_completed" : "video_gen_failed",
        status: outcome === "completed" ? "ok" : "error",
        requestId,
        playerName: queued?.playerName,
        durationMs: queued ? Date.now() - queued.ts : undefined,
        ...(detail ? { detail } : {}),
        ...(error ? { error } : {}),
      };
      current.push(entry);
      return current.length > MAX_EVENTS ? current.slice(-MAX_EVENTS) : current;
    });
  } catch (err) {
    console.error("[event-log] terminal append failed:", err instanceof Error ? err.message : err);
  }
}

export interface LogFilter {
  type?: string;
  player?: string;
  status?: "ok" | "error";
  limit?: number;
}

/** Load events, newest first, with optional filters. */
export async function loadEvents(filter: LogFilter = {}): Promise<LogEvent[]> {
  const all = await blobGet<LogEvent[]>(STORE, KEY, []);
  let events = all;
  if (filter.type) events = events.filter((e) => e.type === filter.type);
  if (filter.status) events = events.filter((e) => e.status === filter.status);
  if (filter.player) {
    const p = filter.player.toLowerCase();
    events = events.filter((e) => e.playerName?.toLowerCase().includes(p));
  }
  events = [...events].reverse(); // newest first
  return filter.limit ? events.slice(0, filter.limit) : events;
}

/** Clear all events (admin action, e.g. fresh booth day). */
export async function clearEvents(): Promise<void> {
  await blobUpdate<LogEvent[]>(STORE, KEY, [], () => []);
}

/** Render events as CSV for download/analysis. */
export function eventsToCsv(events: LogEvent[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "time,type,status,player,roomId,challengeId,requestId,durationMs,detail,error";
  const rows = events.map((e) =>
    [
      new Date(e.ts).toISOString(),
      e.type,
      e.status,
      e.playerName ?? "",
      e.roomId ?? "",
      e.challengeId ?? "",
      e.requestId ?? "",
      e.durationMs ?? "",
      e.detail ? JSON.stringify(e.detail) : "",
      e.error ?? "",
    ].map(esc).join(",")
  );
  return [header, ...rows].join("\n");
}
