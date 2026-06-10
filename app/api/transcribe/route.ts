import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    if (!audio) return NextResponse.json({ error: "No audio" }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ text: "" });

    const openai = new OpenAI({ apiKey });

    const arrayBuffer = await audio.arrayBuffer();
    const file = await toFile(Buffer.from(arrayBuffer), "recording.webm", {
      type: audio.type || "audio/webm",
    });

    const result = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "en",
    });

    return NextResponse.json({ text: result.text });
  } catch (err) {
    console.error("Transcribe error:", err);
    return NextResponse.json({ text: "" });
  }
}
