import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { logEvent } from "@/lib/event-log";
import { getFalKeyPool, withFalKeyFailover, recordRequestKeyIndex } from "@/lib/key-pool";

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const pool = getFalKeyPool();

  if (pool.length === 0) {
    // No key configured — caller should skip video generation (expected, not an error).
    return NextResponse.json({ requestId: null, skipped: true });
  }

  // Stage: parse + validate the request body.
  let userPrompt: string;
  let playerName: string | undefined;
  try {
    const body = await req.json();
    const p = (body as { userPrompt?: string; playerName?: string }).userPrompt;
    playerName = (body as { playerName?: string }).playerName;
    if (!p?.trim()) {
      return NextResponse.json(
        { error: "Prompt is empty.", stage: "request" },
        { status: 400 }
      );
    }
    userPrompt = p.trim();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body.", stage: "request" },
      { status: 400 }
    );
  }

  // Stage: submit to fal.ai queue — returns immediately with a request_id so all
  // concurrent players' jobs land in the queue together instead of being chained.
  // Key chosen round-robin from the pool, with automatic failover to the next
  // key if this one is rejected, rate-limited, or out of quota.
  try {
    let usedKeyIndex = 0;
    const { request_id } = await withFalKeyFailover(async (apiKey) => {
      usedKeyIndex = pool.indexOf(apiKey);
      fal.config({ credentials: apiKey });
      return fal.queue.submit(MODEL, {
        input: {
          prompt: userPrompt,
          duration: 4,
          aspect_ratio: "16:9",
          resolution: "540p",
          audio: false,
        },
      });
    });

    // The poll endpoint must reuse this exact key to check status/fetch the
    // result — a fal.ai queue job is tied to the key that submitted it.
    if (pool.length > 1) await recordRequestKeyIndex(request_id, usedKeyIndex);

    // The matching video_gen_completed/failed event computes total generation
    // time from this event's timestamp.
    await logEvent({
      type: "video_gen_queued", status: "ok", playerName, requestId: request_id,
      durationMs: Date.now() - startTime,
      detail: { model: MODEL, promptChars: userPrompt.length, keyIndex: usedKeyIndex, poolSize: pool.length },
    });
    return NextResponse.json({ requestId: request_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number })?.status;
    console.error("fal.ai queue submit failed:", message, status ? `(HTTP ${status})` : "");
    // 401/403 → bad/expired key; 429 → rate limited/quota; else upstream error.
    const reason =
      status === 401 || status === 403
        ? "fal.ai rejected the API key"
        : status === 429
        ? "fal.ai rate limit or quota reached"
        : `fal.ai queue rejected the job${status ? ` (HTTP ${status})` : ""}`;
    await logEvent({
      type: "video_gen_failed", status: "error", playerName,
      durationMs: Date.now() - startTime,
      detail: { stage: "queue_submit", httpStatus: status ?? null, poolSize: pool.length },
      error: `${reason}: ${message}`,
    });
    return NextResponse.json(
      { error: `${reason}: ${message}`, stage: "queue_submit" },
      { status: 502 }
    );
  }
}
