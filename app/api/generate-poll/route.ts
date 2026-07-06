import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { setCachedVideo } from "@/lib/video-cache";
import { downloadVideoInBackground } from "@/lib/download-video";
import { logVideoGenTerminal } from "@/lib/event-log";

fal.config({ credentials: process.env.FAL_KEY });

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";

// GET /api/generate-poll?requestId=xxx
// Returns { status: "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED"|"FAILED", videoUrl?, error?, stage? }
export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required", stage: "request" }, { status: 400 });
  }

  // Stage: poll the queue for status.
  let status: Awaited<ReturnType<typeof fal.queue.status>>;
  try {
    status = await fal.queue.status(MODEL, { requestId, logs: false });
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
    return NextResponse.json({ status: "FAILED", error: `fal.ai could not generate the video: ${detail}`, stage: "generation" });
  }

  // Still queued or running — tell the client to keep polling.
  if (state !== "COMPLETED") {
    return NextResponse.json({ status: state });
  }

  // Stage: fetch the completed result.
  let output: any;
  try {
    const result = await fal.queue.result(MODEL, { requestId });
    output = result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("fal.ai result fetch failed:", message, "requestId:", requestId);
    await logVideoGenTerminal(requestId, "failed", { stage: "fetch_result" }, message);
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
    return NextResponse.json({ status: "FAILED", error: "fal.ai returned no video URL.", stage: "no_video" });
  }

  const generatedId = `user-${Date.now()}`;
  setCachedVideo(generatedId, videoUrl);
  downloadVideoInBackground(generatedId, videoUrl);

  // durationMs (queue→complete) is computed inside from the queued event.
  await logVideoGenTerminal(requestId, "completed", { videoUrl });

  return NextResponse.json({ status: "COMPLETED", videoUrl });
}
