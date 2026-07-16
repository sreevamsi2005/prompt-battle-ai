import { blobGet, blobUpdate } from "./blob-storage";
// Lite variant + only the cl100k_base ranks — keeps the serverless bundle small
// (the full `js-tiktoken` getEncoding pulls in every model's rank table).
import { Tiktoken } from "js-tiktoken/lite";
import cl100kBase from "js-tiktoken/ranks/cl100k_base";

/* ── AURA usage/cost reporting (external requirement) ────────────────────────
 * One CSV row PER PLAY (one player's attempt at a challenge). Each row carries
 * the token usage + cost of the 3 models a play uses:
 *
 *   google-embeddings-002  — video-similarity embeddings. Embeddings produce no
 *                            text, so there is no output/reasoning to bill:
 *                            output = reasoning = 0 (a real accounting fact).
 *                            Priced on input tokens only at $0.15 / 1M.
 *   gpt-4o-mini            — prompt scoring. Real vendor-reported prompt/
 *                            completion token counts. Not a reasoning model,
 *                            so reasoning = 0. $0.15/1M in, $0.60/1M out.
 *   vidu-q3-turbo (fal.ai) — video generation. No tokenizer exists for video,
 *                            so: input = real cl100k_base count of the prompt,
 *                            output = 4000 synthetic tokens (fixed 4s clip x
 *                            1000), reasoning = 0. Cost is fixed: input $0,
 *                            output $0.14 (4s @ $0.035/s, 540p base rate).
 *
 * Reporting-only plumbing: NOT shown in any UI, NOT part of gameplay. Every
 * write is best-effort and error-swallowed so it can never affect a player.
 *
 * Correlation is server-side: the score route STAGES gpt-4o-mini tokens; the
 * video-similarity route (a play's final step) finalizes the row, joining the
 * staged gpt tokens + the embedding tokens it just produced + the player's
 * email/prompt (from the room submission) + the fal prompt token count.
 */

const STORE = "aura";
const CSV_KEY = "usage-csv";      // the accumulated CSV text
const STAGE_KEY = "score-staging"; // gpt-4o-mini tokens awaiting finalization

// Rates in USD per 1,000,000 tokens.
const GPT_INPUT_RATE = 0.15;
const GPT_OUTPUT_RATE = 0.6;
const EMBED_INPUT_RATE = 0.15; // google-embeddings-002, input-only

// vidu-q3-turbo is fixed per the AURA playbook: 4s clip, 540p base rate.
const VIDU_OUTPUT_TOKENS = 4000; // 4s * 1000 synthetic tokens/second
const VIDU_OUTPUT_COST = 0.14;   // 4s * $0.035/s

const CSV_HEADER = "AttendeeID,TimeStamp,AttendeeInputs,TokenUsage,Cost";

let _enc: Tiktoken | null = null;
// Real cl100k_base token count of the fal prompt. Wrapped so a bundling/load
// failure in any environment degrades to 0 rather than breaking reporting.
function tiktokenCount(text: string): number {
  try {
    if (!_enc) _enc = new Tiktoken(cl100kBase);
    return _enc.encode(text ?? "").length;
  } catch {
    return 0;
  }
}

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
const csvCell = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

interface ScoreStage {
  playerName: string;
  challengeId: string;
  prompt: string;
  gptInput: number;
  gptOutput: number;
  ts: number;
}

/**
 * Stage gpt-4o-mini token usage at score time so the play's final step can join
 * it. Keyed loosely by (playerName, challengeId); consumed on finalize.
 */
export async function stageScoreUsage(rec: ScoreStage): Promise<void> {
  try {
    await blobUpdate<ScoreStage[]>(STORE, STAGE_KEY, [], (cur) => {
      const list = [...(cur ?? []), rec];
      return list.slice(-500); // bound growth; stale unconsumed entries drop off
    });
  } catch (err) {
    console.error("[aura] stageScoreUsage failed:", err instanceof Error ? err.message : err);
  }
}

// Pull (and remove) the most recent staged score for this player+challenge.
function consumeStage(
  list: ScoreStage[],
  playerName: string,
  challengeId: string
): { rec: ScoreStage | null; rest: ScoreStage[] } {
  for (let i = list.length - 1; i >= 0; i--) {
    if (
      list[i].playerName.toLowerCase() === playerName.toLowerCase() &&
      list[i].challengeId === challengeId
    ) {
      return { rec: list[i], rest: list.slice(0, i).concat(list.slice(i + 1)) };
    }
  }
  return { rec: null, rest: list };
}

/**
 * Finalize + append one play's CSV row. Best-effort; never throws.
 */
export async function recordPlay(params: {
  playerName: string;
  challengeId: string;
  timestampMs: number;
  email?: string | null;
  prompt?: string | null;
  embeddingInputTokens: number;
}): Promise<void> {
  try {
    // Join the staged gpt-4o-mini tokens (consume so it isn't reused). Held on an
    // object so TS doesn't narrow it to null across the blobUpdate call boundary.
    const holder: { staged: ScoreStage | null } = { staged: null };
    await blobUpdate<ScoreStage[]>(STORE, STAGE_KEY, [], (cur) => {
      const { rec, rest } = consumeStage(cur ?? [], params.playerName, params.challengeId);
      holder.staged = rec;
      return rest;
    });

    const gptInput = holder.staged?.gptInput ?? 0;
    const gptOutput = holder.staged?.gptOutput ?? 0;
    const prompt = params.prompt || holder.staged?.prompt || "";
    const embedInput = Math.max(0, Math.round(params.embeddingInputTokens || 0));
    const viduInput = tiktokenCount(prompt);

    const tokenUsage = {
      "google-embeddings-002": { input: embedInput, output: 0, reasoning: 0 },
      "gpt-4o-mini": { input: gptInput, output: gptOutput, reasoning: 0 },
      "vidu-q3-turbo": { input: viduInput, output: VIDU_OUTPUT_TOKENS, reasoning: 0, output_synthetic: true },
    };

    const cost = {
      "google-embeddings-002": { input: round8(embedInput * (EMBED_INPUT_RATE / 1e6)), output: 0, reasoning: 0 },
      "gpt-4o-mini": {
        input: round8(gptInput * (GPT_INPUT_RATE / 1e6)),
        output: round8(gptOutput * (GPT_OUTPUT_RATE / 1e6)),
        reasoning: 0,
      },
      "vidu-q3-turbo": { input: 0, output: VIDU_OUTPUT_COST, reasoning: 0 },
    };

    const attendeeId = params.email || params.playerName;
    const attendeeInputs = params.email
      ? { email: params.email, name: params.playerName }
      : { name: params.playerName };
    const timestamp = new Date(params.timestampMs || Date.now()).toISOString();

    const row = [
      csvCell(attendeeId),
      timestamp,
      csvCell(JSON.stringify(attendeeInputs)),
      csvCell(JSON.stringify(tokenUsage)),
      csvCell(JSON.stringify(cost)),
    ].join(",");

    await blobUpdate<string>(STORE, CSV_KEY, "", (cur) => {
      const base = cur && cur.startsWith("AttendeeID") ? cur : CSV_HEADER + "\n";
      return base + row + "\n";
    });
  } catch (err) {
    console.error("[aura] recordPlay failed:", err instanceof Error ? err.message : err);
  }
}

/** Read the accumulated CSV text (header + one row per play). */
export async function loadUsageCsv(): Promise<string> {
  const csv = await blobGet<string>(STORE, CSV_KEY, "");
  return csv || CSV_HEADER + "\n";
}
