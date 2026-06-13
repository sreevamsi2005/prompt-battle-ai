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
  similarityScore: number;
  normalizedScore: number;
  timeTakenToPrompt: number; // seconds
  timestamp: number;
  email?: string;
}

export interface ScoreResult {
  score: number;
  feedback: string;
}

export type GamePhase =
  | "playing"
  | "analyzing"
  | "results";
