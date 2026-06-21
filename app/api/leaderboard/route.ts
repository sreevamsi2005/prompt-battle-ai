import { NextRequest, NextResponse } from "next/server";
import { loadLeaderboard, addEntry, clearLeaderboard } from "@/lib/server-leaderboard";
import { addRoomSubmission, loadRoomSubmissions } from "@/lib/rooms";
import { appendDataSheetRow } from "@/lib/csv-export";
import { isAdminPasswordValid } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (roomId) {
    const submissions = await loadRoomSubmissions(roomId);
    return NextResponse.json(submissions);
  }
  const entries = await loadLeaderboard();
  return NextResponse.json(entries);
}

// POST records either a room submission (on submit) or a global entry (when the
// player chooses to publish to the global leaderboard).
//   scope: "room"   → body { playerName, similarityScore, timeTakenToPrompt, roomId, timestamp?, prompt?, email?, challengeId?, videoTag?, difficulty? }
//   scope: "global" → body { playerName, similarityScore, timeTakenToPrompt, email?, compositeScore?, videoScore? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      playerName,
      similarityScore,
      timeTakenToPrompt,
      roomId,
      scope,
      timestamp,
      prompt,
      email,
      challengeId,
      videoTag,
      difficulty,
      compositeScore,
      videoScore,
    } = body as {
      playerName?: string;
      similarityScore?: number;
      timeTakenToPrompt?: number;
      roomId?: string;
      scope?: "room" | "global";
      timestamp?: number;
      prompt?: string;
      email?: string;
      challengeId?: string;
      videoTag?: string;
      difficulty?: "easy" | "medium" | "hard";
      compositeScore?: number;
      videoScore?: number;
    };

    if (!playerName?.trim() || similarityScore == null) {
      return NextResponse.json(
        { error: "playerName and similarityScore required" },
        { status: 400 }
      );
    }

    const safeTime = timeTakenToPrompt ?? 60;
    // Final score = composite (text+video) when known, else the text score.
    const finalScore = compositeScore ?? similarityScore;

    if (scope === "room") {
      if (!roomId) {
        return NextResponse.json({ error: "roomId required for room scope" }, { status: 400 });
      }
      const subs = await addRoomSubmission(
        roomId,
        playerName,
        similarityScore,
        safeTime,
        difficulty ?? "medium",
        timestamp,
        prompt,
        email
      );

      // Record to data sheet for every room submission
      if (challengeId) {
        const rowId = `${roomId}-${playerName.trim()}-${timestamp ?? Date.now()}`;
        await appendDataSheetRow({
          id: rowId,
          timestamp: timestamp ?? Date.now(),
          playerName: playerName.trim(),
          email: email ?? "",
          videoId: challengeId,
          videoTag: videoTag ?? challengeId,
          difficulty: difficulty ?? "medium",
          similarityScore,
          timeTakenToPrompt: safeTime,
          finalScore,
        }).catch(err => console.error("[data-sheet] append failed:", err));
      }

      return NextResponse.json(subs);
    }

    const entries = await addEntry(playerName, similarityScore, safeTime, email, compositeScore, videoScore);
    return NextResponse.json(entries);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Leaderboard API error:", message);
    return NextResponse.json(
      { error: `Failed to save score: ${message}` },
      { status: 500 }
    );
  }
}

// DELETE clears the global leaderboard. Admin-only (x-admin-password header).
export async function DELETE(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  if (!password || !isAdminPasswordValid(password)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await clearLeaderboard();
    return NextResponse.json({ ok: true, entries: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Leaderboard DELETE error:", message);
    return NextResponse.json({ error: `Failed to clear leaderboard: ${message}` }, { status: 500 });
  }
}
