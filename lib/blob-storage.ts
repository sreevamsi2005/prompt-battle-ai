import fs from "fs";
import os from "os";
import path from "path";

// NETLIFY_BLOBS_CONTEXT is injected by Netlify's runtime when blobs are available.
// Fall back to local file system for dev (npm run dev).
function useBlobs(): boolean {
  return !!process.env.NETLIFY_BLOBS_CONTEXT;
}

// ── Local dev store location ────────────────────────────────────────────────
// In local dev (no Netlify Blobs) the store is file-backed. It MUST live outside
// the project tree: Next's dev watcher (Turbopack in Next 16) recompiles and
// full-reloads the page on ANY change under the project root. Writing gameplay
// state into ./data — rooms.json on every 3s heartbeat, plus submissions,
// leaderboard, and the per-request event log on submit — made the /play page
// "refresh" and snap back to a fresh challenge mid-round. Keeping these writes
// under the OS temp dir hides them from the watcher entirely. (Production uses
// Netlify Blobs, so this whole path is dev-only.)
//
// Reads fall back to the legacy ./data file when the dev-store copy doesn't exist
// yet, so committed seed data (leaderboard) and existing local state (room
// config, video-cost history) is honored once; thereafter writes live out of tree.
const DEV_STORE_DIR = path.join(os.tmpdir(), "prompt-battle-devstore");

// store:key -> bare filename (applied to BOTH the dev store and the ./data fallback).
const LOCAL_FILE: Record<string, string> = {
  "rooms:rooms": "rooms.json",
  "rooms:submissions": "room-submissions.json",
  "leaderboard:entries": "leaderboard.json",
  "videocosts:log": "video-generation-costs.json",
};

function fileName(store: string, key: string): string {
  return LOCAL_FILE[`${store}:${key}`] ?? `${store}-${key}.json`;
}

// Writable location — out of the watched project tree.
function localPath(store: string, key: string): string {
  return path.join(DEV_STORE_DIR, fileName(store, key));
}

// Legacy in-project location — read-only fallback for the first access after this
// change, so existing ./data files keep working until the first write migrates them.
function legacyPath(store: string, key: string): string {
  return path.join(process.cwd(), "data", fileName(store, key));
}

// Path to READ from: prefer the dev store, else the legacy ./data file, else null.
function readablePath(store: string, key: string): string | null {
  const p = localPath(store, key);
  if (fs.existsSync(p)) return p;
  const legacy = legacyPath(store, key);
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

// Exposed so other file-backed dev caches (e.g. lib/video-cache.ts) can keep
// their writes out of the dev watcher's tree too, with the same legacy fallback.
export function devStoreFile(baseName: string): { read: string; write: string } {
  const write = path.join(DEV_STORE_DIR, baseName);
  if (fs.existsSync(write)) return { read: write, write };
  const legacy = path.join(process.cwd(), "data", baseName);
  return { read: fs.existsSync(legacy) ? legacy : write, write };
}

export async function blobGet<T>(store: string, key: string, fallback: T): Promise<T> {
  if (useBlobs()) {
    try {
      const { getStore } = await import("@netlify/blobs");
      const data = await getStore(store).get(key, { type: "json" });
      return data !== null ? (data as T) : fallback;
    } catch (err) {
      console.error(`[blobs] get ${store}/${key} failed:`, err);
      return fallback;
    }
  }

  const file = readablePath(store, key);
  if (file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
    } catch (err) {
      console.error(`[fs] read ${file} failed:`, err);
    }
  }
  return fallback;
}

export async function blobSet<T>(store: string, key: string, data: T): Promise<void> {
  if (useBlobs()) {
    const { getStore } = await import("@netlify/blobs");
    // Let errors propagate so callers know when persistence fails
    await getStore(store).set(key, JSON.stringify(data));
    return;
  }

  const file = localPath(store, key);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

/* ── Atomic primitives for concurrency-safe writes (e.g. slot locking) ──
 * On Netlify these use conditional writes (onlyIfNew / onlyIfMatch) so two
 * simultaneous requests cannot both succeed. Locally we run a single process,
 * so file existence + mtime-as-etag is a faithful enough simulation for dev. */

export interface EtagResult<T> {
  value: T | null;
  etag?: string;
}

export async function blobGetWithEtag<T>(store: string, key: string): Promise<EtagResult<T>> {
  if (useBlobs()) {
    try {
      const { getStore } = await import("@netlify/blobs");
      const res = await getStore(store).getWithMetadata(key, { type: "json" });
      if (!res) return { value: null };
      return { value: res.data as T, etag: res.etag };
    } catch (err) {
      console.error(`[blobs] getWithMetadata ${store}/${key} failed:`, err);
      return { value: null };
    }
  }

  const p = localPath(store, key);
  try {
    if (fs.existsSync(p)) {
      const value = JSON.parse(fs.readFileSync(p, "utf-8")) as T;
      return { value, etag: String(fs.statSync(p).mtimeMs) };
    }
    // Legacy ./data fallback — return NO etag so blobUpdate treats it as
    // "create new" and the first write lands in the dev store via blobSetIfNew.
    const legacy = legacyPath(store, key);
    if (fs.existsSync(legacy)) {
      return { value: JSON.parse(fs.readFileSync(legacy, "utf-8")) as T };
    }
  } catch (err) {
    console.error(`[fs] read ${p} failed:`, err);
  }
  return { value: null };
}

/** Write only if the key does NOT already exist. Returns whether we won. */
export async function blobSetIfNew<T>(store: string, key: string, data: T): Promise<{ modified: boolean }> {
  if (useBlobs()) {
    const { getStore } = await import("@netlify/blobs");
    const res = await getStore(store).setJSON(key, data, { onlyIfNew: true });
    return { modified: res.modified };
  }

  const file = localPath(store, key);
  if (fs.existsSync(file)) return { modified: false };
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  return { modified: true };
}

/** Write only if the current ETag matches. Returns whether we won. */
export async function blobSetIfMatch<T>(store: string, key: string, data: T, etag: string): Promise<{ modified: boolean }> {
  if (useBlobs()) {
    const { getStore } = await import("@netlify/blobs");
    const res = await getStore(store).setJSON(key, data, { onlyIfMatch: etag });
    return { modified: res.modified };
  }

  const file = localPath(store, key);
  try {
    if (!fs.existsSync(file)) return { modified: false };
    if (String(fs.statSync(file).mtimeMs) !== etag) return { modified: false };
  } catch {
    return { modified: false };
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  return { modified: true };
}

export async function blobDelete(store: string, key: string): Promise<void> {
  if (useBlobs()) {
    const { getStore } = await import("@netlify/blobs");
    await getStore(store).delete(key);
    return;
  }

  const file = localPath(store, key);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.error(`[fs] delete ${file} failed:`, err);
  }
}

/**
 * Read-modify-write with optimistic concurrency. Reapplies `mutate` against the
 * latest value and retries if another writer changed the key in between, so two
 * simultaneous updates never clobber each other (the bug behind lost scores when
 * several players submit at once). Returns the value that was written.
 */
export async function blobUpdate<T>(
  store: string,
  key: string,
  fallback: T,
  mutate: (current: T) => T,
  maxRetries = 6
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { value, etag } = await blobGetWithEtag<T>(store, key);
    const next = mutate(value ?? fallback);

    if (value === null || etag === undefined) {
      const { modified } = await blobSetIfNew(store, key, next);
      if (modified) return next;
    } else {
      const { modified } = await blobSetIfMatch(store, key, next, etag);
      if (modified) return next;
    }
    // Contended — another writer won this round; loop re-reads and reapplies.
  }
  throw new Error(`blobUpdate: ${store}/${key} stayed contended after ${maxRetries} retries`);
}
