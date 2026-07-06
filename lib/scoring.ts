export type Difficulty = "easy" | "medium" | "hard";

// The FINAL score is 40% prompt (text) + 60% video similarity.
// Until the video is analyzed the score stays null — never show text score alone.
export function computeFinalScore(textScore: number, videoScore?: number | null): number | null {
  if (videoScore == null) return null;
  return Math.round(textScore * 0.4 + videoScore * 0.6);
}

// A short qualitative remark for the results screen, based on the final score.
export function evaluationRemark(finalScore: number): string {
  if (finalScore >= 85) return "Outstanding — a near-perfect recreation of the original.";
  if (finalScore >= 70) return "Great work — a strong match to the reference.";
  if (finalScore >= 50) return "Good effort — you captured the main idea.";
  if (finalScore >= 30) return "Partial match — refine the key details next time.";
  return "Off target — study the clip and try a sharper prompt.";
}
