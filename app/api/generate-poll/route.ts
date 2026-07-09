import { NextRequest, NextResponse } from "next/server";
import { createFalClient } from "@fal-ai/client";
import { setCachedVideo } from "@/lib/video-cache";
import { downloadVideoInBackground } from "@/lib/download-video";
import { logVideoGenTerminal, loadEvents } from "@/lib/event-log";
import { getKeyForRequest, clearRequestKeyIndex } from "@/lib/key-pool";
import { recordVideoGenerationCost } from "@/lib/video-cost-log";

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";

// GET /api/generate-poll?requestId=xxx
// Returns { status: "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED"|"FAILED", videoUrl?, error?, stage? }
export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required", stage: "request" }, { status: 400 });
  }

  // A fal.ai queue job is tied to whichever key submitted it — reuse that
  // same key here rather than the pool's current round-robin key, or the
  // status check/result fetch would silently fail to find the job.
  const apiKey = await getKeyForRequest(requestId);
  if (!apiKey) {
    return NextResponse.json({ status: "FAILED", error: "No fal.ai API key configured", stage: "queue_status" });
  }
  // Isolated client scoped to this key — see the note in generate-prompt/route.ts
  // on why this must not be the shared global `fal` singleton + fal.config().
  const client = createFalClient({ credentials: apiKey });

  // Stage: poll the queue for status.
  let status: Awaited<ReturnType<typeof client.queue.status>>;
  try {
    status = await client.queue.status(MODEL, { requestId, logs: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("fal.ai queue status check failed:", message, "requestId:", requestId);
    return NextResponse.json({ status: "FAILED", error: `Could not reach fal.ai queue: ${message}`, stage: "queue_status" });
  }

  // fal.ai's TS types only model IN_QUEUE/IN_PROGRESS/COMPLETED, but the API
  // can also return FAILED/CANCELLED at runtime — compare as a plain string.
  const state = String(status.status);

  // Terminal failure states reported by fal.ai — stop polling immediately.
  if (state === "FAILED" || state === "CANCELLED") {
    const raw = (status as any).error;
    const detail = typeof raw === "string" ? raw : raw?.message ?? `Job ${state.toLowerCase()} on fal.ai`;
    console.error(`fal.ai job ${state}:`, detail, "requestId:", requestId);
    await logVideoGenTerminal(requestId, "failed", { stage: "generation", falState: state }, detail);
    await clearRequestKeyIndex(requestId);
    return NextResponse.json({ status: "FAILED", error: `fal.ai could not generate the video: ${detail}`, stage: "generation" });
  }

  // Still queued or running — tell the client to keep polling.
  if (state !== "COMPLETED") {
    return NextResponse.json({ status: state });
  }

  // Stage: fetch the completed result.
  let output: any;
  try {
    const result = await client.queue.result(MODEL, { requestId });
    output = result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("fal.ai result fetch failed:", message, "requestId:", requestId);
    await logVideoGenTerminal(requestId, "failed", { stage: "fetch_result" }, message);
    await clearRequestKeyIndex(requestId);
    return NextResponse.json({ status: "FAILED", error: `Could not download the result from fal.ai: ${message}`, stage: "fetch_result" });
  }

  // Stage: extract the video URL (model output shapes vary).
  const videoUrl: string | undefined =
    output?.video?.url ??
    output?.videos?.[0]?.url ??
    output?.output?.video?.url ??
    output?.url;

  if (!videoUrl) {
    const shape = JSON.stringify(output ?? {}).slice(0, 200);
    console.error("Unexpected fal.ai result shape:", shape);
    await logVideoGenTerminal(requestId, "failed", { stage: "no_video", resultShape: shape }, "fal.ai returned no video URL");
    await clearRequestKeyIndex(requestId);
    return NextResponse.json({ status: "FAILED", error: "fal.ai returned no video URL.", stage: "no_video" });
  }

  const generatedId = `user-${Date.now()}`;
  setCachedVideo(generatedId, videoUrl);
  downloadVideoInBackground(generatedId, videoUrl);

  // durationMs (queue→complete) is computed inside from the queued event.
  await logVideoGenTerminal(requestId, "completed", { videoUrl });
  await clearRequestKeyIndex(requestId);

  // Cost/usage record — looks up the original prompt + player from the
  // matching video_gen_queued event (same requestId). Never throws; a
  // logging failure here must not affect the player's result.
  const queuedEvent = (await loadEvents({ type: "video_gen_queued" })).find((e) => e.requestId === requestId);
  await recordVideoGenerationCost({
    id: generatedId,
    requestId,
    videoUrl,
    prompt: (queuedEvent?.detail?.prompt as string | undefined) ?? null,
    playerName: queuedEvent?.playerName,
  });

  return NextResponse.json({ status: "COMPLETED", videoUrl });
}
