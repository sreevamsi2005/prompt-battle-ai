import { NextRequest, NextResponse } from "next/server";
import { isAdminPasswordValid } from "@/lib/admin-auth";
import {
  loadRooms,
  createRoom,
  updateRoomChallenge,
  deleteRoom,
  loadRoomSubmissions,
  loadReplayRequests,
  clearReplayRequests,
  clearRoomSubmissions
} from "@/lib/rooms";
import { getPromptById, getRandomPrompt } from "@/lib/booth-prompts";
import { getCachedVideo } from "@/lib/video-cache";

function checkAuth(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password ? isAdminPasswordValid(password) : false;
}

function buildChallengeDetails(activeChallengeId: string | null) {
  if (!activeChallengeId) return null;
  const challenge = getPromptById(activeChallengeId);
  if (!challenge) return null;
  const cached = getCachedVideo(challenge.id);
  // Use localPath when the file is committed to git (downloaded: true).
  // localVideoExists() always returns false on Netlify because public/ is not
  // accessible from serverless functions — the file is served as a static asset.
  const videoUrl = cached
    ? (cached.downloaded ? cached.localPath : (cached.cdnUrl || ""))
    : "";
  return { id: challenge.id, theme: challenge.theme, difficulty: challenge.difficulty, videoUrl };
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
        submissions: submissions.sort((a, b) => b.points - a.points),
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

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const { name, maxUsers } = body as { name?: string; maxUsers?: number };
    if (!name?.trim()) return NextResponse.json({ error: "Room name required" }, { status: 400 });
    const rooms = await createRoom(name.trim(), maxUsers || 4);
    return NextResponse.json(await enrichRooms(rooms));
  } catch (err) {
    console.error("Admin rooms POST error:", err);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
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
    // Setting a new challenge resolves any pending "play again" requests.
    await clearReplayRequests(id);
    return NextResponse.json(room);
  } catch (err) {
    console.error("Admin rooms PUT error:", err);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}

// PATCH /api/admin/rooms?id=ROOM — operational actions on a room.
// body: { action: "reset-scores" | "clear-requests" | "assign-random" }
export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Room ID required" }, { status: 400 });
    const { action } = (await req.json()) as { action?: string };

    if (action === "reset-scores") {
      await clearRoomSubmissions(id);
      await clearReplayRequests(id);
    } else if (action === "clear-requests") {
      await clearReplayRequests(id);
    } else if (action === "assign-random") {
      const pick = getRandomPrompt();
      await updateRoomChallenge(id, pick.id);
      await clearReplayRequests(id);
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

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Room ID required" }, { status: 400 });
    const rooms = await deleteRoom(id);
    return NextResponse.json(rooms);
  } catch (err) {
    console.error("Admin rooms DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete room" }, { status: 500 });
  }
}
