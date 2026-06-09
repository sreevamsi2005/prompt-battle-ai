import { NextResponse } from "next/server";
import { loadRooms } from "@/lib/rooms";

// GET /api/rooms - List all rooms for players to join
export async function GET() {
  try {
    const rooms = loadRooms();
    
    // Select minimal details needed for room joiner
    const list = rooms.map(room => ({
      id: room.id,
      name: room.name,
      maxUsers: room.maxUsers,
      activePlayersCount: room.players?.length || 0,
      activeChallengeId: room.activeChallengeId
    }));

    return NextResponse.json(list);
  } catch (err) {
    console.error("Public rooms GET error:", err);
    return NextResponse.json({ error: "Failed to list rooms" }, { status: 500 });
  }
}
