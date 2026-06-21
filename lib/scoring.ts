export type Difficulty = "easy" | "medium" | "hard";

// The FINAL score is a plain 50/50 blend of prompt (text) and video similarity —
// no difficulty normalization. Until the video is analyzed it's just the text score.
export function computeFinalScore(textScore: number, videoScore?: number | null): number {
  if (videoScore == null) return Math.round(textScore);
  return Math.round(textScore * 0.5 + videoScore * 0.5);
}

// A short qualitative remark for the results screen, based on the final score.
export function evaluationRemark(finalScore: number): string {
  if (finalScore >= 85) return "Outstanding — a near-perfect recreation of the original.";
  if (finalScore >= 70) return "Great work — a strong match to the reference.";
  if (finalScore >= 50) return "Good effort — you captured the main idea.";
  if (finalScore >= 30) return "Partial match — refine the key details next time.";
  return "Off target — study the clip and try a sharper prompt.";
}
