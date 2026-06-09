import type { ScoreResult } from "@/lib/types";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const FEEDBACK_BY_TIER: Record<"low" | "mid" | "high", string[]> = {
  low: [
    "The AI sensed a different world entirely — your vision diverged from the original cinematic frame.",
    "Semantic drift detected. The booth neural lens sees another story in your words.",
  ],
  mid: [
    "You're circling the truth. Key motifs align, but the atmosphere still shifts in the shadows.",
    "Partial semantic resonance — the AI catches your tone, yet misses the full cinematic beat.",
  ],
  high: [
    "Striking alignment. Your prompt echoes the hidden imagination with cinematic precision.",
    "Near-perfect semantic match — the booth AI applauds your reverse-engineering instinct.",
  ],
};

export function mockScore(
  originalPrompt: string,
  userPrompt: string
): ScoreResult {
  const orig = tokenize(originalPrompt);
  const user = tokenize(userPrompt);
  const similarity = jaccardSimilarity(orig, user);

  let score = Math.round(similarity * 70 + Math.min(userPrompt.length / 20, 15));
  if (
    userPrompt.toLowerCase().includes(originalPrompt.toLowerCase().slice(0, 12))
  ) {
    score = Math.min(100, score + 20);
  }
  score = Math.max(5, Math.min(100, score));

  const tier =
    score < 40 ? "low" : score <= 75 ? "mid" : "high";
  const options = FEEDBACK_BY_TIER[tier];
  const feedback = options[Math.floor(Math.random() * options.length)];

  return { score, feedback };
}
