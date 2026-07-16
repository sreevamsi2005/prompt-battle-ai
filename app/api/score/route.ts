import { NextRequest, NextResponse, after } from "next/server";
import OpenAI from "openai";
import { mockScore } from "@/lib/mock-score";
import { getPromptById } from "@/lib/booth-prompts";
import { logEvent } from "@/lib/event-log";
import { stageScoreUsage } from "@/lib/aura-usage";

const SCORE_PROMPT = `Compare these two prompts semantically and return JSON only with this exact shape:
{"score": <number 0-100>, "feedback": "<short cinematic feedback, max 2 sentences>"}

Score guidelines:
- 90-100: Nearly identical meaning and cinematic details
- 70-89: Strong overlap in subject, mood, and setting
- 40-69: Partial overlap, missing key elements
- 0-39: Different concept or missing core imagery

Original Prompt:
{original}

User Prompt:
{user}`;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const body = await request.json();
  const { challengeId, userPrompt, playerName } = body as {
    challengeId?: string;
    userPrompt?: string;
    playerName?: string;
  };

  if (!challengeId || !userPrompt?.trim()) {
    return NextResponse.json(
      { error: "challengeId and userPrompt are required" },
      { status: 400 }
    );
  }

  const booth = getPromptById(challengeId);
  if (!booth) {
    await logEvent({
      type: "text_score", status: "error", playerName, challengeId,
      durationMs: Date.now() - startTime, error: "Unknown challenge",
    });
    return NextResponse.json({ error: "Unknown challenge" }, { status: 404 });
  }

  const originalPrompt = booth.prompt;
  // Records which engine produced the score + how long it took, for the logs.
  const logScore = (scorer: string, score: number, error?: string) =>
    logEvent({
      type: "text_score",
      status: error ? "error" : "ok",
      playerName,
      challengeId,
      durationMs: Date.now() - startTime,
      detail: { scorer, score, promptChars: userPrompt.trim().length },
      ...(error ? { error } : {}),
    });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!apiKey && !geminiKey) {
      const result = mockScore(originalPrompt, userPrompt);
      await logScore("mock (no API keys)", result.score);
      return NextResponse.json(result);
    }

    if (geminiKey && !apiKey) {
      const result = await scoreWithGemini(geminiKey, originalPrompt, userPrompt);
      await logScore("gemini-2.0-flash", result.score);
      return NextResponse.json(result);
    }

    const openai = new OpenAI({ apiKey: apiKey! });
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a cinematic prompt similarity judge for an AI booth game. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: SCORE_PROMPT.replace("{original}", originalPrompt).replace(
            "{user}",
            userPrompt
          ),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    const result = parseScoreResponse(content);
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    // External usage reporting only (AURA) — stage this play's gpt-4o-mini token
    // usage so the video-similarity step can assemble the play's CSV row. Runs via
    // after() so it never blocks the response yet still executes reliably on
    // serverless (unlike a bare fire-and-forget, which a post-response freeze can
    // drop); stageScoreUsage also swallows its own errors.
    const usage = completion.usage;
    after(() =>
      stageScoreUsage({
        playerName: playerName ?? "",
        challengeId,
        prompt: userPrompt.trim(),
        gptInput: usage?.prompt_tokens ?? 0,
        gptOutput: usage?.completion_tokens ?? 0,
        ts: Date.now(),
      })
    );
    await logScore(model, result.score);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Score API error:", error);
    // Model call failed → mock fallback keeps the game going; log both facts.
    const result = mockScore(originalPrompt, userPrompt);
    await logScore("mock (fallback after error)", result.score,
      error instanceof Error ? error.message : String(error));
    return NextResponse.json(result);
  }
}

async function scoreWithGemini(
  apiKey: string,
  originalPrompt: string,
  userPrompt: string
) {
  const prompt = SCORE_PROMPT.replace("{original}", originalPrompt).replace(
    "{user}",
    userPrompt
  );

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);

  const data = await res.json();
  // Note: this Gemini fallback scorer only runs when no OpenAI key is set; it is
  // not one of the 3 AURA-tracked models, so no usage is staged here.
  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text ??
    '{"score":0,"feedback":"Unable to analyze."}';
  return parseScoreResponse(text);
}

function parseScoreResponse(content: string | null | undefined) {
  if (!content) throw new Error("Empty model response");
  const parsed = JSON.parse(content) as { score?: number; feedback?: string };
  const score = Math.round(Math.max(0, Math.min(100, Number(parsed.score) || 0)));
  const feedback =
    typeof parsed.feedback === "string" && parsed.feedback.trim()
      ? parsed.feedback.trim()
      : "The AI processed your cinematic semantics.";
  return { score, feedback };
}
