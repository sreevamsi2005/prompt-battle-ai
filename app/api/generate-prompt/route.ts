import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });

const MODEL = "fal-ai/vidu/q3/text-to-video/turbo";

export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    // No key configured — caller should skip video generation (expected, not an error).
    return NextResponse.json({ requestId: null, skipped: true });
  }

  // Stage: parse + validate the request body.
  let userPrompt: string;
  try {
    const body = await req.json();
    const p = (body as { userPrompt?: string }).userPrompt;
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
  try {
    const { request_id } = await fal.queue.submit(MODEL, {
      input: {
        prompt: userPrompt,
        duration: 4,
        aspect_ratio: "16:9",
        resolution: "540p",
        audio: false,
      },
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
    return NextResponse.json(
      { error: `${reason}: ${message}`, stage: "queue_submit" },
      { status: 502 }
    );
  }
}
