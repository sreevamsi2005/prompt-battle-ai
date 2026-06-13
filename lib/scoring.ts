export const LEVEL_AVERAGES = {
  easy: 80,
  medium: 70,
  hard: 60,
} as const;

export type Difficulty = "easy" | "medium" | "hard";

export function computeNormalizedScore(
  similarityScore: number,
  difficulty: Difficulty
): number {
  const average = LEVEL_AVERAGES[difficulty];
  return Math.round((similarityScore / average) * 100);
}
