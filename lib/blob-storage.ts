import { getStore } from "@netlify/blobs";
import fs from "fs";
import path from "path";

// Use Netlify Blobs when deployed; fall back to local file system for dev
const USE_BLOBS = process.env.NETLIFY === "true";

const LOCAL_FILE: Record<string, string> = {
  "rooms:rooms": "data/rooms.json",
  "rooms:submissions": "data/room-submissions.json",
  "leaderboard:entries": "data/leaderboard.json",
};

export async function blobGet<T>(store: string, key: string, fallback: T): Promise<T> {
  if (USE_BLOBS) {
    try {
      const data = await getStore(store).get(key, { type: "json" });
      return data !== null ? (data as T) : fallback;
    } catch (err) {
      console.error(`blobGet(${store}/${key}) error:`, err);
      return fallback;
    }
  }
  const file = path.join(process.cwd(), LOCAL_FILE[`${store}:${key}`] ?? `data/${store}-${key}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch (err) {
    console.error(`fs read(${file}) error:`, err);
  }
  return fallback;
}

export async function blobSet<T>(store: string, key: string, data: T): Promise<void> {
  if (USE_BLOBS) {
    try {
      await getStore(store).set(key, JSON.stringify(data));
    } catch (err) {
      console.error(`blobSet(${store}/${key}) error:`, err);
    }
    return;
  }
  const file = path.join(process.cwd(), LOCAL_FILE[`${store}:${key}`] ?? `data/${store}-${key}.json`);
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`fs write(${file}) error:`, err);
  }
}
