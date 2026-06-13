import fs from "fs";
import path from "path";

// Statically imported — bundled at Next.js build time so it's available
// inside Netlify Functions where fs cannot reach project root data files.
import staticCacheData from "../data/video-cache.json";

export interface CacheEntry {
  cdnUrl: string;
  localPath: string;
  downloaded: boolean;
}

const CACHE_FILE = path.join(process.cwd(), "data", "video-cache.json");

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

  // 1. Seed from the statically-bundled JSON — always works, including on Netlify.
  for (const [k, v] of Object.entries(staticCacheData as Record<string, CacheEntry | string>)) {
    loadEntry(k, v);
  }

  // 2. Override with the live file when running locally (non-fatal if absent).
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, CacheEntry | string>;
      for (const [k, v] of Object.entries(data)) {
        loadEntry(k, v);
      }
    }
  } catch {
    // non-fatal — static import already seeded the cache
  }
}

function persist() {
  try {
    const obj = Object.fromEntries(memCache.entries());
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf-8");
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
