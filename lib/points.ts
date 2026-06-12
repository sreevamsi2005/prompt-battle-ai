// Competition points awarded per submission, derived from challenge difficulty
// and the similarity score (0-100) returned by the scoring model.
//
//   easy   → 10  |  medium → 20  |  hard → 40   (full award)
//   >70%        → full award
//   50%–70%     → half award (rounded)
//   <50%        → 0
export type Difficulty = "easy" | "medium" | "hard";

const MAX_POINTS: Record<Difficulty, number> = {
  easy: 10,
  medium: 20,
  hard: 40,
};

export function computePoints(difficulty: Difficulty, similarity: number): number {
  const max = MAX_POINTS[difficulty] ?? MAX_POINTS.easy;
  if (similarity > 70) return max;
  if (similarity >= 50) return Math.round(max / 2);
  return 0;
}
