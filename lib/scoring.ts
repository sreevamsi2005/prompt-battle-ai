export const LEVEL_AVERAGES = {
  easy: 80,
  medium: 70,
  hard: 60,
} as const;

// The hardest difficulty's average is the reference point that tops out at 100.
const HARDEST_AVERAGE = Math.min(...Object.values(LEVEL_AVERAGES)); // 60

export type Difficulty = "easy" | "medium" | "hard";

// Difficulty-fair normalized score, kept in the 0–100 range.
// Scaled so the hardest difficulty tops out at 100 and easier levels scale down
// proportionally (hitting your difficulty's "par" average maps to the same value
// for everyone, while exceptional hard runs are rewarded with the higher ceiling).
// Ceilings: easy 75 · medium 86 · hard 100. Equivalent to dividing the old
// 0–167 normalized score by its max (~1.67).
export function computeNormalizedScore(
  similarityScore: number,
  difficulty: Difficulty
): number {
  const average = LEVEL_AVERAGES[difficulty];
  const raw = (similarityScore * HARDEST_AVERAGE) / average;
  return Math.round(Math.max(0, Math.min(100, raw)));
}
