import { blobUpdate, blobGet, blobDelete } from "./blob-storage";

/* ── fal.ai API key pool: round-robin + automatic failover ────────────────
 * A booth event can put several concurrent players through video generation
 * at once. One key alone can hit fal.ai's rate limit or run out of credits
 * mid-event — both have happened before. Configuring multiple keys
 * (FAL_KEYS="key1,key2,key3") spreads load round-robin across all of them,
 * and automatically retries with the next key if one is rejected/rate-limited,
 * so a single bad key never stalls the booth.
 *
 * IMPORTANT: a fal.ai queue job is tied to the key that submitted it — status
 * checks and result fetches MUST reuse that same key, not a freshly rotated
 * one. See recordRequestKey / getRequestKey below.
 */

const KEY_POOL_STORE = "keypool";
const ROUND_ROBIN_COUNTER_KEY = "fal-rr-index";

function parseKeyList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

// FAL_KEYS takes priority when set; falls back to the single FAL_KEY so
// existing single-key deployments keep working unchanged.
export function getFalKeyPool(): string[] {
  const multi = parseKeyList(process.env.FAL_KEYS);
  if (multi.length > 0) return multi;
  return parseKeyList(process.env.FAL_KEY);
}

// Atomically advances a shared counter and returns the index to use for THIS
// call. Backed by Netlify Blobs (local JSON file in dev via blob-storage.ts),
// so rotation is fair across every concurrent serverless function instance —
// not just within one warm container.
async function nextRoundRobinIndex(poolSize: number): Promise<number> {
  let used = 0;
  await blobUpdate<{ index: number }>(KEY_POOL_STORE, ROUND_ROBIN_COUNTER_KEY, { index: 0 }, (cur) => {
    used = ((cur.index % poolSize) + poolSize) % poolSize; // defensive if pool size changed
    return { index: (used + 1) % poolSize };
  });
  return used;
}

// Retryable = the KEY itself is plausibly the problem (expired, rejected,
// rate-limited) — trying a different key can fix it. Anything else (malformed
// request, genuine fal.ai outage) won't be helped by rotating keys, so we
// fail fast instead of burning through the whole pool for no reason.
function isKeyRelatedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403 || status === 429;
}

/**
 * Runs `fn` with a fal.ai key chosen by round-robin, retrying with the next
 * key in the pool if the call fails for a key-related reason. Tries every key
 * at most once per call before giving up and rethrowing the last error.
 * Single-key pools skip the round-robin bookkeeping entirely (no Blobs
 * round-trip) and just use that one key directly.
 */
export async function withFalKeyFailover<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
  const pool = getFalKeyPool();
  if (pool.length === 0) throw new Error("No fal.ai API key configured");
  if (pool.length === 1) return fn(pool[0]);

  const startIndex = await nextRoundRobinIndex(pool.length);
  let lastErr: unknown;
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const idx = (startIndex + attempt) % pool.length;
    try {
      return await fn(pool[idx]);
    } catch (err) {
      lastErr = err;
      if (!isKeyRelatedError(err)) throw err;
      console.warn(`[fal-key-pool] key #${idx + 1}/${pool.length} failed (HTTP ${(err as { status?: number })?.status}), trying next key`);
    }
  }
  throw lastErr;
}

/* ── request_id -> key index mapping ───────────────────────────────────────
 * A fal.ai job must be polled with the SAME key that submitted it. Record
 * which pool index actually succeeded so the poll endpoint can look it back
 * up, then clean the mapping up once the job reaches a terminal state. */

export async function recordRequestKeyIndex(requestId: string, keyIndex: number): Promise<void> {
  await blobUpdate<Record<string, number>>(KEY_POOL_STORE, "request-key-index", {}, (cur) => ({
    ...cur,
    [requestId]: keyIndex,
  }));
}

// Returns the key that submitted this request_id, falling back to the first
// pool key if there's no recorded mapping (single-key pools never record one).
export async function getKeyForRequest(requestId: string): Promise<string | undefined> {
  const pool = getFalKeyPool();
  if (pool.length === 0) return undefined;
  const map = await blobGet<Record<string, number>>(KEY_POOL_STORE, "request-key-index", {});
  const idx = map[requestId];
  return idx != null && pool[idx] != null ? pool[idx] : pool[0];
}

export async function clearRequestKeyIndex(requestId: string): Promise<void> {
  try {
    const map = await blobGet<Record<string, number>>(KEY_POOL_STORE, "request-key-index", {});
    if (!(requestId in map)) return;
    const rest = { ...map };
    delete rest[requestId];
    if (Object.keys(rest).length === 0) {
      await blobDelete(KEY_POOL_STORE, "request-key-index");
    } else {
      await blobUpdate<Record<string, number>>(KEY_POOL_STORE, "request-key-index", {}, () => rest);
    }
  } catch (err) {
    console.error("[fal-key-pool] cleanup failed:", err instanceof Error ? err.message : err);
  }
}
