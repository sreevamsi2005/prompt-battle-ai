import { NextResponse } from "next/server";
import { loadRooms } from "@/lib/rooms";
import { loadLeaderboard } from "@/lib/server-leaderboard";

// GET /api/debug - Check storage status (remove before production if sensitive)
export async function GET() {
  const storage = process.env.NETLIFY_BLOBS_CONTEXT ? "netlify-blobs" : "local-fs";
  try {
    const [rooms, leaderboard] = await Promise.all([loadRooms(), loadLeaderboard()]);
    return NextResponse.json({
      storage,
      rooms: rooms.length,
      leaderboard: leaderboard.length,
      env: {
        NETLIFY: process.env.NETLIFY ?? "(not set)",
        hasBlobs: !!process.env.NETLIFY_BLOBS_CONTEXT,
        hasFalKey: !!process.env.FAL_KEY,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasAdminPw: !!process.env.ADMIN_PASSWORD,
      },
    });
  } catch (err) {
    return NextResponse.json({ storage, error: String(err) }, { status: 500 });
  }
}
