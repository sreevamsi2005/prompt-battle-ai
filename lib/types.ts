export interface Challenge {
  id: number;
  video: string;
  prompt: string;
  difficulty: "easy" | "medium" | "hard";
  recreationVideos: {
    low: string;
    medium: string;
    high: string;
  };
}

export interface LeaderboardEntry {
  playerName: string;
  similarityScore: number;   // text/prompt similarity 0-100
  normalizedScore: number;
  timeTakenToPrompt: number; // seconds
  timestamp: number;
  email?: string;
  videoScore?: number;       // visual similarity 0-100 (once analyzed)
  compositeScore?: number;   // text*0.5 + video*0.5 — the real combined similarity
}

export interface ScoreResult {
  score: number;
  feedback: string;
}

export type GamePhase =
  | "playing"
  | "analyzing"
  | "results";
