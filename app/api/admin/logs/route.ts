import { NextRequest, NextResponse } from "next/server";
import { isAdminPasswordValid } from "@/lib/admin-auth";
import { loadEvents, clearEvents, eventsToCsv } from "@/lib/event-log";

function checkAuth(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password ? isAdminPasswordValid(password) : false;
}

// GET /api/admin/logs?limit=200&type=video_similarity&player=alice&status=error&format=csv
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const q = req.nextUrl.searchParams;
    const events = await loadEvents({
      type: q.get("type") ?? undefined,
      player: q.get("player") ?? undefined,
      status: (q.get("status") as "ok" | "error" | null) ?? undefined,
      limit: q.get("limit") ? Math.max(1, Number(q.get("limit"))) : 500,
    });

    if (q.get("format") === "csv") {
      return new NextResponse(eventsToCsv(events), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="booth-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return NextResponse.json(events);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/admin/logs — wipe the event log (e.g. fresh booth day).
export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await clearEvents();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
