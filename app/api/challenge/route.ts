import { NextResponse } from "next/server";
import { getRandomPrompt } from "@/lib/booth-prompts";

// Always serve from local /public/videos — no fal.ai calls needed
export async function GET() {
  const booth = getRandomPrompt();
  return NextResponse.json({
    challengeId: booth.id,
    videoUrl: `/videos/${booth.id}.mp4`,
    difficulty: booth.difficulty,
    theme: booth.theme,
  });
}
