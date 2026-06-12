import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    // No key configured — caller should skip video generation
    return NextResponse.json({ requestId: null, skipped: true });
  }

  try {
    const body = await req.json();
    const { userPrompt } = body as { userPrompt?: string };
    if (!userPrompt?.trim()) {
      return NextResponse.json({ error: "userPrompt required" }, { status: 400 });
    }

    // Submit to queue — returns immediately with a request_id.
    // All concurrent players' jobs land in fal.ai queue at the same time
    // instead of being chained by our server.
    const { request_id } = await fal.queue.submit(MODEL, {
      input: {
        prompt: userPrompt.trim(),
        duration: 4,
        aspect_ratio: "16:9",
        resolution: "540p",
        audio: false,
      },
    });

    return NextResponse.json({ requestId: request_id });
  } catch (err) {
    console.error("Generate submit error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
