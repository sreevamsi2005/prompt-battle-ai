import { NextRequest, NextResponse } from "next/server";
import { addReplayRequest } from "@/lib/rooms";

// POST /api/rooms/replay-request
// body: { roomId, playerName } — a player asks the admin for the next challenge.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, playerName } = body as { roomId?: string; playerName?: string };

    if (!roomId || !playerName?.trim()) {
      return NextResponse.json(
        { error: "roomId and playerName required", stage: "request" },
        { status: 400 }
      );
    }

    await addReplayRequest(roomId, playerName.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Replay request error:", message);
    return NextResponse.json(
      { error: `Could not send request: ${message}`, stage: "storage" },
      { status: 500 }
    );
  }
}
