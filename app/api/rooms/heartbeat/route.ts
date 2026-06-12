import { NextRequest, NextResponse } from "next/server";
import { registerPlayerHeartbeat, loadRoomSubmissions, loadReplayRequests } from "@/lib/rooms";
import { getPromptById } from "@/lib/booth-prompts";
import { getCachedVideo } from "@/lib/video-cache";
import { localVideoExists } from "@/lib/download-video";

// POST /api/rooms/heartbeat - Heartbeat check for players in a room
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, playerName } = body as { roomId?: string; playerName?: string };

    if (!roomId || !playerName?.trim()) {
      return NextResponse.json(
        { error: "roomId and playerName required" },
        { status: 400 }
      );
    }

    const room = await registerPlayerHeartbeat(roomId, playerName.trim());
    if (!room) {
      return NextResponse.json(
        { error: "Room not found or full" },
        { status: 404 }
      );
    }

    // Get active challenge details
    let challengeDetails = null;
    if (room.activeChallengeId) {
      const challenge = getPromptById(room.activeChallengeId);
      if (challenge) {
        const cached = getCachedVideo(challenge.id);
        const videoUrl = cached
          ? (localVideoExists(challenge.id) ? cached.localPath : cached.cdnUrl)
          : "";
        challengeDetails = {
          id: challenge.id,
          theme: challenge.theme,
          difficulty: challenge.difficulty,
          videoUrl
        };
      }
    }

    // Get submissions for local leaderboard
    const submissions = await loadRoomSubmissions(roomId);
    const replayRequests = await loadReplayRequests(roomId);

    // Form list of active players and whether they've submitted
    const activePlayersStatus = room.players.map(p => {
      const sub = submissions.find(s => s.playerName.toLowerCase() === p.playerName.toLowerCase());
      return {
        playerName: p.playerName,
        hasSubmitted: !!sub,
        score: sub ? sub.score : null,
        points: sub ? sub.points : null
      };
    });

    return NextResponse.json({
      id: room.id,
      name: room.name,
      maxUsers: room.maxUsers,
      activeChallengeId: room.activeChallengeId,
      challengeDetails,
      players: activePlayersStatus,
      submissions: submissions.sort((a, b) => b.points - a.points),
      replayRequests: replayRequests.sort((a, b) => a.timestamp - b.timestamp)
    });
  } catch (err) {
    console.error("Room heartbeat error:", err);
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 });
  }
}
