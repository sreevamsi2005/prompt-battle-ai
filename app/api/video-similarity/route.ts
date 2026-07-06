import { NextRequest, NextResponse } from "next/server";
import { getPromptById } from "@/lib/booth-prompts";
import { analyzeVideoSimilarity } from "@/lib/video-analysis";
import { updateRoomSubmissionWithVideoScore, markRoomSubmissionVideoUnavailable } from "@/lib/rooms";
import { logEvent } from "@/lib/event-log";
import { computeFinalScore } from "@/lib/scoring";

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
      await logEvent({
        type: "video_similarity", status: "error", playerName, roomId, challengeId,
        durationMs: Date.now() - startTime, error: "Challenge not found",
      });
      return NextResponse.json({ error: "Challenge not found", compositeScore: textScore, videoScore: null }, { status: 200 });
    }

    // Absolute HTTPS URL so ffmpeg can fetch it in the serverless function.
    const referenceVideoUrl = `${resolveOrigin(req)}/videos/${challenge.id}.mp4`;

    // Stage 1+2: embed & score. Primary path sends the FULL videos to
    // gemini-embedding-2 (one vector per video); if that hasn't finished
    // within 30s (its latency can spike unpredictably) it falls back to
    // 16-frame sampling automatically inside analyzeVideoSimilarity.
    let videoScore: number, vFeedback: string, method: string, framesProcessed: number;
    try {
      ({ score: videoScore, feedback: vFeedback, method, framesProcessed } =
        await analyzeVideoSimilarity(referenceVideoUrl, userVideoUrl));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[video-similarity] analysis failed:", message);
      if (roomId) await markRoomSubmissionVideoUnavailable(roomId, playerName);
      await logEvent({
        type: "video_similarity", status: "error", playerName, roomId, challengeId,
        durationMs: Date.now() - startTime,
        detail: { stage: "video_analysis", textScore },
        error: message,
      });
      return NextResponse.json({ error: message, stage: "video_analysis", videoScore: null, compositeScore: textScore }, { status: 200 });
    }

    const compositeScore = computeFinalScore(textScore, videoScore)!;

    // Stage 3: update room submission with video + composite scores
    if (roomId) {
      try {
        await updateRoomSubmissionWithVideoScore(roomId, playerName, videoScore, textScore);
      } catch (err) {
        console.error("[video-similarity] submission update failed:", err instanceof Error ? err.message : err);
      }
    }

    await logEvent({
      type: "video_similarity", status: "ok", playerName, roomId, challengeId,
      durationMs: Date.now() - startTime,
      detail: { method, framesProcessed, videoScore, textScore, compositeScore },
    });

    return NextResponse.json({
      videoScore,
      compositeScore,
      feedback: vFeedback,
      method,
      framesProcessed,
      executionMs: Date.now() - startTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[video-similarity] unexpected error:", message);
    await logEvent({
      type: "video_similarity", status: "error",
      durationMs: Date.now() - startTime,
      detail: { stage: "unexpected" },
      error: message,
    });
    return NextResponse.json({ error: message, videoScore: null, compositeScore: null }, { status: 500 });
  }
}
