import { NextRequest, NextResponse } from "next/server";
import { loadLeaderboard, addEntry } from "@/lib/server-leaderboard";
import { addRoomSubmission, loadRoomSubmissions } from "@/lib/rooms";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (roomId) {
    const submissions = await loadRoomSubmissions(roomId);
    return NextResponse.json(submissions.sort((a, b) => b.points - a.points));
  }
  const entries = await loadLeaderboard();
  return NextResponse.json(entries.sort((a, b) => b.score - a.score));
}

// POST records either a room submission (on submit) or a global entry (when the
// player chooses to publish to the global leaderboard).
//   scope: "room"   → body { playerName, similarity, points, roomId }
//   scope: "global" → body { playerName, points }   (default)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { playerName, points, similarity, roomId, scope } = body as {
      playerName?: string;
      points?: number;
      similarity?: number;
      roomId?: string;
      scope?: "room" | "global";
    };

    if (!playerName?.trim() || typeof points !== "number") {
      return NextResponse.json(
        { error: "playerName and points required", stage: "request" },
        { status: 400 }
      );
    }

    if (scope === "room") {
      if (!roomId) {
        return NextResponse.json({ error: "roomId required for room scope", stage: "request" }, { status: 400 });
      }
      const subs = await addRoomSubmission(roomId, playerName, similarity ?? 0, points);
      return NextResponse.json(subs.sort((a, b) => b.points - a.points));
    }

    const entries = await addEntry(playerName, points);
    return NextResponse.json(entries.sort((a, b) => b.score - a.score));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Leaderboard API error:", message);
    return NextResponse.json(
      { error: `Failed to save score: ${message}`, stage: "storage" },
      { status: 500 }
    );
  }
}
