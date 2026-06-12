import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { setCachedVideo } from "@/lib/video-cache";
import { downloadVideoInBackground } from "@/lib/download-video";

fal.config({ credentials: process.env.FAL_KEY });

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";

// GET /api/generate-poll?requestId=xxx
// Returns { status: "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED", videoUrl? }
export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  try {
    const status = await fal.queue.status(MODEL, { requestId, logs: false });

    // Terminal failure states — stop polling immediately
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      const raw = (status as any).error;
      const detail = typeof raw === "string" ? raw : raw?.message ?? `Job ${status.status.toLowerCase()} on fal.ai`;
      console.error(`fal.ai job ${status.status}:`, detail, "requestId:", requestId);
      return NextResponse.json({ status: "FAILED", error: detail });
    }

    if (status.status !== "COMPLETED") {
      return NextResponse.json({ status: status.status });
    }

    // Fetch the actual result only when done
    const result = await fal.queue.result(MODEL, { requestId });
    const output = result.data as any;
    // Try common output shapes from fal.ai video models
    const videoUrl: string | undefined =
      output?.video?.url ??
      output?.videos?.[0]?.url ??
      output?.output?.video?.url ??
      output?.url;

    if (!videoUrl) {
      const shape = JSON.stringify(output ?? {}).slice(0, 200);
      console.error("Unexpected fal.ai result shape:", shape);
      return NextResponse.json({ status: "FAILED", error: `No video URL in response. Shape: ${shape}` });
    }

    const generatedId = `user-${Date.now()}`;
    setCachedVideo(generatedId, videoUrl);
    downloadVideoInBackground(generatedId, videoUrl);

    return NextResponse.json({ status: "COMPLETED", videoUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Generate poll error:", message);
    // Return FAILED so clients stop polling rather than retrying indefinitely
    return NextResponse.json({ status: "FAILED", error: message });
  }
}
