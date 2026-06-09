import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import {
  downloadVideoInBackground,
  localVideoExists,
} from "@/lib/download-video";
import { setCachedVideo } from "@/lib/video-cache";

fal.config({ credentials: process.env.FAL_KEY });

/**
 * Generate video from user's submitted prompt
 * POST /api/generate-prompt
 * Body: { userPrompt: string }
 * Returns: { videoUrl: string, promptUsed: string }
 */
export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      { error: "FAL_KEY not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { userPrompt } = body as { userPrompt?: string };

    if (!userPrompt?.trim()) {
      return NextResponse.json(
        { error: "userPrompt required" },
        { status: 400 }
      );
    }

    // Generate video via fal.ai — no audio, lower res = faster + cheaper
    const result = await fal.subscribe("fal-ai/vidu/q3/text-to-video/turbo", {
      input: {
        prompt: userPrompt.trim(),
        duration: 4,        // shorter = faster generation
        aspect_ratio: "16:9",
        resolution: "540p", // lower res = faster, still looks great side-by-side
        audio: false,       // no audio = cheaper credits + faster
      },
    });

    const output = result.data as { video?: { url: string } };
    const videoUrl = output?.video?.url;

    if (!videoUrl) {
      throw new Error("No video URL in response");
    }

    // Create a unique ID for this generated video and cache it
    const generatedId = `user-${Date.now()}`;
    setCachedVideo(generatedId, videoUrl);

    // Trigger background download
    downloadVideoInBackground(generatedId, videoUrl);

    return NextResponse.json({
      videoUrl,
      promptUsed: userPrompt.trim(),
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("Generate prompt error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
