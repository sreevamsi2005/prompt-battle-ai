import fs from "fs";
import path from "path";

// NETLIFY_BLOBS_CONTEXT is injected by Netlify's runtime when blobs are available.
// Fall back to local file system for dev (npm run dev).
function useBlobs(): boolean {
  return !!process.env.NETLIFY_BLOBS_CONTEXT;
}

const LOCAL_FILE: Record<string, string> = {
  "rooms:rooms": "data/rooms.json",
  "rooms:submissions": "data/room-submissions.json",
  "leaderboard:entries": "data/leaderboard.json",
};

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

  const file = path.join(process.cwd(), LOCAL_FILE[`${store}:${key}`] ?? `data/${store}-${key}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch (err) {
    console.error(`[fs] read ${file} failed:`, err);
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

  const file = path.join(process.cwd(), LOCAL_FILE[`${store}:${key}`] ?? `data/${store}-${key}.json`);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}
