import fs from "fs";
import path from "path";

export interface CacheEntry {
  cdnUrl: string;
  localPath: string;
  downloaded: boolean;
}

const CACHE_FILE = path.join(process.cwd(), "data", "video-cache.json");

// In-memory cache — loaded once, written on each new generation
const memCache = new Map<string, CacheEntry>();
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, CacheEntry | string>;
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") {
          // Upgrade old format (just URL string) to new format
          memCache.set(k, {
            cdnUrl: v,
            localPath: `/videos/${k}.mp4`,
            downloaded: false,
          });
        } else {
          memCache.set(k, v);
        }
      }
    }
  } catch {
    // cache file corrupt — start fresh
  }
}

function persist() {
  try {
    const obj = Object.fromEntries(memCache.entries());
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch {
    // non-fatal — in-memory cache still works
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

export function setCachedVideo(
  promptId: string,
  cdnUrl: string,
  downloaded = false
) {
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
