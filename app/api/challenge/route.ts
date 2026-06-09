import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { getRandomPrompt } from "@/lib/booth-prompts";
import { getCachedVideo, setCachedVideo } from "@/lib/video-cache";
import {
  downloadVideoInBackground,
  localVideoExists,
} from "@/lib/download-video";

fal.config({ credentials: process.env.FAL_KEY });

export async function GET() {
  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      { error: "FAL_KEY not configured in .env" },
      { status: 503 }
    );
  }

  const booth = getRandomPrompt();

  // Check if video is cached
  const cached = getCachedVideo(booth.id);
  if (cached) {
    // Determine which URL to use: local if downloaded, otherwise CDN
    const videoUrl = localVideoExists(booth.id)
      ? cached.localPath
      : cached.cdnUrl;

    // Trigger background download if not already downloaded
    if (!cached.downloaded && !localVideoExists(booth.id)) {
      downloadVideoInBackground(booth.id, cached.cdnUrl);
    }

    return NextResponse.json({
      challengeId: booth.id,
      videoUrl,
      difficulty: booth.difficulty,
      theme: booth.theme,
      cached: true,
    });
  }

  // Generate video via fal.ai — costs 1 credit, cached forever after
  try {
    const result = await fal.subscribe("fal-ai/vidu/q3/text-to-video/turbo", {
      input: {
        prompt: booth.prompt,
        duration: 5,
        aspect_ratio: "16:9",
        resolution: "720p",
        audio: true,
      },
    });

    const output = result.data as { video?: { url: string } };
    const videoUrl = output?.video?.url;

    if (!videoUrl) throw new Error("No video URL returned");

    // Cache the new video and trigger background download
    setCachedVideo(booth.id, videoUrl);
    downloadVideoInBackground(booth.id, videoUrl);

    return NextResponse.json({
      challengeId: booth.id,
      videoUrl, // Return CDN URL for immediate playback
      difficulty: booth.difficulty,
      theme: booth.theme,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
