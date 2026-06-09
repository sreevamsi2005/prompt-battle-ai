import { NextRequest, NextResponse } from "next/server";
import { getPromptById } from "@/lib/booth-prompts";

// Only reveals the prompt after scoring — called from results screen
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const booth = getPromptById(id);
  if (!booth) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ prompt: booth.prompt });
}
