import fs from "fs";
import path from "path";
import { devStoreFile } from "./blob-storage";

export interface CacheEntry {
  cdnUrl: string;
  localPath: string;
  downloaded: boolean;
}

// Dev cache lives outside the project tree (see blob-storage.ts) so writes don't
// trip Next's dev file-watcher and reload the page. Reads fall back to any
// existing ./data/video-cache.json until the first write migrates it.
const { read: CACHE_READ_FILE, write: CACHE_WRITE_FILE } = devStoreFile("video-cache.json");

const memCache = new Map<string, CacheEntry>();
let loaded = false;

function loadEntry(k: string, v: CacheEntry | string) {
  if (typeof v === "string") {
    memCache.set(k, { cdnUrl: v, localPath: `/videos/${k}.mp4`, downloaded: false });
  } else {
    memCache.set(k, v as CacheEntry);
  }
}

function load() {
  if (loaded) return;
  loaded = true;

  // Load from local file when running in dev (non-fatal if absent).
  try {
    if (fs.existsSync(CACHE_READ_FILE)) {
      const raw = fs.readFileSync(CACHE_READ_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, CacheEntry | string>;
      for (const [k, v] of Object.entries(data)) {
        loadEntry(k, v);
      }
    }
  } catch {
    // non-fatal
  }
}

function persist() {
  try {
    const obj = Object.fromEntries(memCache.entries());
    const dir = path.dirname(CACHE_WRITE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_WRITE_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch {
    // non-fatal — Netlify filesystem is read-only outside /tmp
  }
}

export function getCachedVideo(promptId: string): CacheEntry | null {
  load();
  return memCache.get(promptId) ?? null;
}

export function getVideoUrl(promptId: string): string | null {
  const entry = getCachedVideo(promptId);
  return entry?.cdnUrl ?? null;
}

export function setCachedVideo(promptId: string, cdnUrl: string, downloaded = false) {
  load();
  memCache.set(promptId, {
    cdnUrl,
    localPath: `/videos/${promptId}.mp4`,
    downloaded,
  });
  persist();
}

export function markAsDownloaded(promptId: string) {
  load();
  const entry = memCache.get(promptId);
  if (entry) {
    entry.downloaded = true;
    persist();
  }
}
