import { NextResponse } from "next/server";
import { loadRooms } from "@/lib/rooms";
import { getPromptById } from "@/lib/booth-prompts";

// GET /api/rooms - List all rooms for players to join
export async function GET() {
  try {
    const rooms = loadRooms();

    const list = rooms.map(room => {
      let challengeDetails = null;
      if (room.activeChallengeId) {
        const prompt = getPromptById(room.activeChallengeId);
        if (prompt) {
          challengeDetails = {
            challengeId: prompt.id,
            videoUrl: `/videos/${prompt.id}.mp4`,
            difficulty: prompt.difficulty,
            theme: prompt.theme,
          };
        }
      }

      return {
        id: room.id,
        name: room.name,
        maxUsers: room.maxUsers,
        createdAt: room.createdAt,
        activePlayersCount: room.players?.length || 0,
        activeChallengeId: room.activeChallengeId,
        challengeDetails,
      };
    });

    return NextResponse.json(list);
  } catch (err) {
    console.error("Public rooms GET error:", err);
    return NextResponse.json({ error: "Failed to list rooms" }, { status: 500 });
  }
}
