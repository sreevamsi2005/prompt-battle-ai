import type { LeaderboardEntry } from "@/lib/types";

const PLAYER_NAME_KEY = "pb_player_name";

/**
 * Client-side: Save/retrieve player name from localStorage
 */
export function getPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLAYER_NAME_KEY);
}

export function setPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAYER_NAME_KEY, name.trim());
}

/**
 * Mock data for fallback
 */
export function getMockLeaderboard(): LeaderboardEntry[] {
  return [
    { playerName: "NeonOracle", score: 94, timestamp: Date.now() - 3600000 },
    { playerName: "PromptSamurai", score: 88, timestamp: Date.now() - 7200000 },
    { playerName: "CineMind", score: 81, timestamp: Date.now() - 10800000 },
    { playerName: "VoxelDreamer", score: 72, timestamp: Date.now() - 14400000 },
    { playerName: "LatentWave", score: 65, timestamp: Date.now() - 18000000 },
  ];
}
