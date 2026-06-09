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
  score: number;
  timestamp: number;
}

export interface ScoreResult {
  score: number;
  feedback: string;
}

export type GamePhase =
  | "playing"
  | "analyzing"
  | "results";
