import { NextRequest, NextResponse } from "next/server";
import { loadLeaderboard, saveLeaderboard, addEntry } from "@/lib/server-leaderboard";
import { addRoomSubmission } from "@/lib/rooms";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (roomId) {
    // Return sorted submissions for specific room
    const submissions = require("@/lib/rooms").loadRoomSubmissions(roomId);
    return NextResponse.json(submissions.sort((a: any, b: any) => b.score - a.score));
  }
  const entries = loadLeaderboard();
  const sorted = entries.sort((a, b) => b.score - a.score);
  return NextResponse.json(sorted);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { playerName, score, roomId } = body as {
      playerName?: string;
      score?: number;
      roomId?: string;
    };

    if (!playerName?.trim() || typeof score !== "number") {
      return NextResponse.json(
        { error: "playerName and score required" },
        { status: 400 }
      );
    }

    // Save to room leaderboard if roomId is provided
    if (roomId) {
      addRoomSubmission(roomId, playerName, score);
    }

    // Save to global leaderboard
    const entries = addEntry(playerName, score);
    return NextResponse.json(entries.sort((a, b) => b.score - a.score));
  } catch (err) {
    console.error("Leaderboard API error:", err);
    return NextResponse.json(
      { error: "Failed to save score" },
      { status: 500 }
    );
  }
}
