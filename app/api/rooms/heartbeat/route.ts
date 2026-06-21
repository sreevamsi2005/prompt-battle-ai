import { NextRequest, NextResponse } from "next/server";
import { registerPlayerHeartbeat, loadRoomSubmissions, loadReplayRequests } from "@/lib/rooms";
import { getPromptById } from "@/lib/booth-prompts";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, playerName } = body as { roomId?: string; playerName?: string };

    if (!roomId || !playerName?.trim()) {
      return NextResponse.json({ error: "roomId and playerName required" }, { status: 400 });
    }

    const room = await registerPlayerHeartbeat(roomId, playerName.trim());
    if (!room) {
      return NextResponse.json({ error: "Room not found or full" }, { status: 404 });
    }

    let challengeDetails = null;
    if (room.activeChallengeId) {
      const challenge = getPromptById(room.activeChallengeId);
      if (challenge) {
        challengeDetails = {
          challengeId: challenge.id,
          theme: challenge.theme,
          difficulty: challenge.difficulty,
          videoUrl: `/videos/${challenge.id}.mp4`,
        };
      }
    }

    const submissions = await loadRoomSubmissions(roomId);
    const replayRequests = await loadReplayRequests(roomId);

    const finalOf = (s: { compositeScore?: number; score: number }) => s.compositeScore ?? s.score;

    const activePlayersStatus = room.players.map(p => {
      const sub = submissions.find(s => s.playerName.toLowerCase() === p.playerName.toLowerCase());
      return {
        playerName: p.playerName,
        hasSubmitted: !!sub,
        score: sub ? sub.score : null,
        finalScore: sub ? finalOf(sub) : null,
      };
    });

    // Sort submissions by final score DESC, timeTakenToPrompt ASC
    const sortedSubs = [...submissions].sort((a, b) => {
      if (finalOf(b) !== finalOf(a)) return finalOf(b) - finalOf(a);
      return a.timeTakenToPrompt - b.timeTakenToPrompt;
    });

    return NextResponse.json({
      id: room.id,
      name: room.name,
      maxUsers: room.maxUsers,
      activeChallengeId: room.activeChallengeId,
      battleStartedAt: room.battleStartedAt ?? null,
      challengeDetails,
      players: activePlayersStatus,
      submissions: sortedSubs,
      replayRequests: replayRequests.sort((a, b) => a.timestamp - b.timestamp),
    });
  } catch (err) {
    console.error("Room heartbeat error:", err);
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 });
  }
}
