export interface LeaderboardEntry {
  playerName: string;
  similarityScore: number;   // text/prompt similarity 0-100
  timeTakenToPrompt: number; // seconds
  timestamp: number;
  email?: string;
  videoScore?: number;       // visual similarity 0-100 (once analyzed)
  compositeScore?: number;   // FINAL score — see computeFinalScore() in lib/scoring.ts (the ranking metric)
}

export interface ScoreResult {
  score: number;
  feedback: string;
}
