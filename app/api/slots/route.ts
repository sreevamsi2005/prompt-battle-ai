import { NextRequest, NextResponse } from "next/server";
import { claimSlot, heartbeatSlot, releaseSlot } from "@/lib/slots";

// POST /api/slots
// body: { action: "claim"|"heartbeat"|"release", slotNum, deviceId, playerName? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, slotNum, deviceId, playerName } = body as {
      action: string;
      slotNum: number;
      deviceId: string;
      playerName?: string;
    };

    if (!action || !slotNum || !deviceId) {
      return NextResponse.json({ error: "action, slotNum, deviceId required" }, { status: 400 });
    }

    if (action === "claim") {
      if (!playerName?.trim()) {
        return NextResponse.json({ error: "playerName required for claim" }, { status: 400 });
      }
      const result = await claimSlot(slotNum, deviceId, playerName.trim());
      return NextResponse.json(result);
    }

    if (action === "heartbeat") {
      const ok = await heartbeatSlot(slotNum, deviceId);
      return NextResponse.json({ ok });
    }

    if (action === "release") {
      await releaseSlot(slotNum, deviceId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action", stage: "request" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Slots API error:", message);
    // Storage-layer failure — caller cannot safely assume the slot is free.
    return NextResponse.json(
      { error: `Slot service unavailable: ${message}`, stage: "storage" },
      { status: 503 }
    );
  }
}
