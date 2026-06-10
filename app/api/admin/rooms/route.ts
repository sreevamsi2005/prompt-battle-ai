import { NextRequest, NextResponse } from "next/server";
import { isAdminPasswordValid } from "@/lib/admin-auth";
import {
  loadRooms,
  createRoom,
  updateRoomChallenge,
  deleteRoom,
  loadRoomSubmissions
} from "@/lib/rooms";
import { getPromptById } from "@/lib/booth-prompts";
import { getCachedVideo } from "@/lib/video-cache";
import { localVideoExists } from "@/lib/download-video";

function checkAuth(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password ? isAdminPasswordValid(password) : false;
}

// GET /api/admin/rooms - List all rooms (with active challenges & player stats)
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rooms = loadRooms();
    const roomsWithDetails = rooms.map(room => {
      // Find challenge detail if selected
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
      
      // Load room submissions
      const submissions = loadRoomSubmissions(room.id);
      
      return {
        ...room,
        challengeDetails,
        submissionCount: submissions.length,
        submissions: submissions.sort((a, b) => b.score - a.score)
      };
    });

    return NextResponse.json(roomsWithDetails);
  } catch (err) {
    console.error("Admin rooms GET error:", err);
    return NextResponse.json({ error: "Failed to load rooms" }, { status: 500 });
  }
}

// POST /api/admin/rooms - Create a room
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, maxUsers } = body as { name?: string; maxUsers?: number };

    if (!name?.trim()) {
      return NextResponse.json({ error: "Room name required" }, { status: 400 });
    }

    const rooms = createRoom(name.trim(), maxUsers || 4);

    // Return enriched rooms with challenge details and submissions (same format as GET)
    const roomsWithDetails = rooms.map(room => {
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

      const submissions = loadRoomSubmissions(room.id);

      return {
        ...room,
        challengeDetails,
        submissionCount: submissions.length,
        submissions: submissions.sort((a, b) => b.score - a.score)
      };
    });

    return NextResponse.json(roomsWithDetails);
  } catch (err) {
    console.error("Admin rooms POST error:", err);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}

// PUT /api/admin/rooms - Update active challenge for a room
export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = req.nextUrl.searchParams.get("id");
    const body = await req.json();
    const { challengeId } = body as { challengeId: string | null };

    if (!id) {
      return NextResponse.json({ error: "Room ID required" }, { status: 400 });
    }

    const room = updateRoomChallenge(id, challengeId);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    return NextResponse.json(room);
  } catch (err) {
    console.error("Admin rooms PUT error:", err);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}

// DELETE /api/admin/rooms - Delete a room
export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Room ID required" }, { status: 400 });
    }

    const rooms = deleteRoom(id);
    return NextResponse.json(rooms);
  } catch (err) {
    console.error("Admin rooms DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete room" }, { status: 500 });
  }
}
