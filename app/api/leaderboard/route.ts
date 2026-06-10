import { NextRequest, NextResponse } from "next/server";
import { loadLeaderboard, addEntry } from "@/lib/server-leaderboard";
import { addRoomSubmission, loadRoomSubmissions } from "@/lib/rooms";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (roomId) {
    const submissions = await loadRoomSubmissions(roomId);
    return NextResponse.json(submissions.sort((a: any, b: any) => b.score - a.score));
  }
  const entries = await loadLeaderboard();
  return NextResponse.json(entries.sort((a, b) => b.score - a.score));
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

    if (roomId) {
      await addRoomSubmission(roomId, playerName, score);
    }

    const entries = await addEntry(playerName, score);
    return NextResponse.json(entries.sort((a, b) => b.score - a.score));
  } catch (err) {
    console.error("Leaderboard API error:", err);
    return NextResponse.json(
      { error: "Failed to save score" },
      { status: 500 }
    );
  }
}
