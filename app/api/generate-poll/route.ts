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

    if (status.status !== "COMPLETED") {
      return NextResponse.json({ status: status.status });
    }

    // Fetch the actual result only when done
    const result = await fal.queue.result(MODEL, { requestId });
    const output = result.data as { video?: { url: string } };
    const videoUrl = output?.video?.url;

    if (!videoUrl) throw new Error("No video URL in fal.ai result");

    const generatedId = `user-${Date.now()}`;
    setCachedVideo(generatedId, videoUrl);
    downloadVideoInBackground(generatedId, videoUrl);

    return NextResponse.json({ status: "COMPLETED", videoUrl });
  } catch (err) {
    console.error("Generate poll error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
