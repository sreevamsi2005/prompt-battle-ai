import { NextRequest, NextResponse } from "next/server";
import { isAdminPasswordValid } from "@/lib/admin-auth";
import {
  loadRooms,
  updateRoomChallenge,
  updateRoomMaxUsers,
  startBattle,
  loadRoomSubmissions,
  loadReplayRequests,
  clearReplayRequests,
  clearRoomSubmissions
} from "@/lib/rooms";
import { getPromptById, getRandomPrompt } from "@/lib/booth-prompts";

function checkAuth(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password ? isAdminPasswordValid(password) : false;
}

function buildChallengeDetails(activeChallengeId: string | null) {
  if (!activeChallengeId) return null;
  const challenge = getPromptById(activeChallengeId);
  if (!challenge) return null;
  return { id: challenge.id, theme: challenge.theme, difficulty: challenge.difficulty, videoUrl: `/videos/${challenge.id}.mp4` };
}

async function enrichRooms(rooms: Awaited<ReturnType<typeof loadRooms>>) {
  return Promise.all(
    rooms.map(async room => {
      const submissions = await loadRoomSubmissions(room.id);
      const replayRequests = await loadReplayRequests(room.id);
      return {
        ...room,
        challengeDetails: buildChallengeDetails(room.activeChallengeId),
        submissionCount: submissions.length,
        submissions: submissions.sort((a, b) => {
          const fa = a.compositeScore ?? a.score;
          const fb = b.compositeScore ?? b.score;
          return fb !== fa ? fb - fa : a.timeTakenToPrompt - b.timeTakenToPrompt;
        }),
        replayRequests: replayRequests.sort((a, b) => a.timestamp - b.timestamp),
      };
    })
  );
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rooms = await loadRooms();
    return NextResponse.json(await enrichRooms(rooms));
  } catch (err) {
    console.error("Admin rooms GET error:", err);
    return NextResponse.json({ error: "Failed to load rooms" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get("id");
    const body = await req.json();
    const { challengeId } = body as { challengeId: string | null };
    if (!id) return NextResponse.json({ error: "Room ID required" }, { status: 400 });
    const room = await updateRoomChallenge(id, challengeId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    await clearReplayRequests(id);
    const rooms = await loadRooms();
    return NextResponse.json(await enrichRooms(rooms));
  } catch (err) {
    console.error("Admin rooms PUT error:", err);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}

// PATCH /api/admin/rooms?id=ROOM — operational actions on a room.
// body: { action: "reset-scores" | "clear-requests" | "assign-random" | "update-max-users", maxUsers?: number }
export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Room ID required" }, { status: 400 });
    const body = (await req.json()) as { action?: string; maxUsers?: number };
    const { action } = body;

    if (action === "reset-scores") {
      await clearRoomSubmissions(id);
      await clearReplayRequests(id);
    } else if (action === "clear-requests") {
      await clearReplayRequests(id);
    } else if (action === "assign-random") {
      const pick = getRandomPrompt();
      await updateRoomChallenge(id, pick.id);
      await clearReplayRequests(id);
    } else if (action === "update-max-users") {
      const max = Number(body.maxUsers);
      if (isNaN(max) || max < 1) return NextResponse.json({ error: "Invalid maxUsers" }, { status: 400 });
      await updateRoomMaxUsers(id, max);
    } else if (action === "start-battle") {
      await startBattle(id);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const rooms = await loadRooms();
    return NextResponse.json(await enrichRooms(rooms));
  } catch (err) {
    console.error("Admin rooms PATCH error:", err);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}
