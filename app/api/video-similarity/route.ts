import { NextRequest, NextResponse } from "next/server";
import { getPromptById } from "@/lib/booth-prompts";
import { extractFrames, scoreVideoSimilarity } from "@/lib/video-analysis";
import { updateRoomSubmissionWithVideoScore, markRoomSubmissionVideoUnavailable } from "@/lib/rooms";

// Allow up to 60 s on Netlify (default is 10 s, which isn't enough for
// frame extraction + vision scoring + blob update).
export const maxDuration = 60;

// Build the absolute origin of this deployment so ffmpeg can fetch the reference
// video over HTTPS. The local public/ folder is NOT in the serverless function's
// filesystem on Netlify, so a relative /videos path can't be read there.
function resolveOrigin(req: NextRequest): string {
  const host = req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return process.env.URL ?? req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { challengeId, userVideoUrl, textScore, roomId, playerName, submissionTimestamp } =
      body as {
        challengeId?: string;
        userVideoUrl?: string;
        textScore?: number;
        roomId?: string;
        playerName?: string;
        submissionTimestamp?: number;
      };

    if (!challengeId || !userVideoUrl || textScore == null || !playerName || !submissionTimestamp) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const challenge = getPromptById(challengeId);
    if (!challenge) {
      if (roomId) await markRoomSubmissionVideoUnavailable(roomId, playerName);
      return NextResponse.json({ error: "Challenge not found", compositeScore: textScore, videoScore: null }, { status: 200 });
    }

    // Absolute HTTPS URL so ffmpeg can fetch it in the serverless function.
    const referenceVideoUrl = `${resolveOrigin(req)}/videos/${challenge.id}.mp4`;

    // Stage 1: extract frames
    let referenceFrames: Buffer[], userFrames: Buffer[];
    try {
      [referenceFrames, userFrames] = await Promise.all([
        extractFrames(referenceVideoUrl, 4),
        extractFrames(userVideoUrl, 4),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[video-similarity] frame extraction failed:", message);
      if (roomId) await markRoomSubmissionVideoUnavailable(roomId, playerName);
      return NextResponse.json({ error: message, stage: "frame_extraction", videoScore: null, compositeScore: textScore }, { status: 200 });
    }

    // Stage 2: score with the vision model
    let videoScore: number, vFeedback: string;
    try {
      ({ score: videoScore, feedback: vFeedback } = await scoreVideoSimilarity(referenceFrames, userFrames));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[video-similarity] vision scoring failed:", message);
      if (roomId) await markRoomSubmissionVideoUnavailable(roomId, playerName);
      return NextResponse.json({ error: message, stage: "vision_scoring", videoScore: null, compositeScore: textScore }, { status: 200 });
    }

    const compositeScore = Math.round(textScore * 0.3 + videoScore * 0.7);

    // Stage 3: update room submission with video + composite scores
    if (roomId) {
      try {
        await updateRoomSubmissionWithVideoScore(roomId, playerName, videoScore, textScore);
      } catch (err) {
        console.error("[video-similarity] submission update failed:", err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({
      videoScore,
      compositeScore,
      feedback: vFeedback,
      framesProcessed: referenceFrames.length,
      executionMs: Date.now() - startTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[video-similarity] unexpected error:", message);
    return NextResponse.json({ error: message, videoScore: null, compositeScore: null }, { status: 500 });
  }
}
